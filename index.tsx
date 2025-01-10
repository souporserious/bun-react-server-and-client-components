import type { BuildArtifact } from 'bun'
import { readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse } from 'es-module-lexer'
import { relative, join } from 'node:path'
import { createElement } from 'react'
// @ts-expect-error
import * as ReactServerDom from 'react-server-dom-parcel/server.browser'

// ---------------------------------------------------------------------------
// GLOBAL MAP for RSC references
// ---------------------------------------------------------------------------
const clientComponentMap: Record<string, any> = {}

// ---------------------------------------------------------------------------
// Paths & Utilities
// ---------------------------------------------------------------------------

function resolveApp(path = '') {
  const appDir = new URL('./app/', import.meta.url)
  return fileURLToPath(new URL(path, appDir))
}

function resolveBuild(path = '') {
  const buildDir = new URL('./build/', import.meta.url)
  return fileURLToPath(new URL(path, buildDir))
}

const reactComponentRegex = /\.tsx$/

/**
 * Recursively gather all `.tsx` files in `./app`, so we can detect `'use client'`.
 */
async function collectAppFiles(directoryPath = resolveApp()) {
  const items = await readdir(directoryPath, { withFileTypes: true })
  let results: string[] = []

  for (const item of items) {
    const fullPath = join(directoryPath, item.name)
    if (item.isDirectory()) {
      results = results.concat(await collectAppFiles(fullPath))
    } else if (item.isFile() && reactComponentRegex.test(item.name)) {
      results.push(fullPath)
    }
  }

  return results
}

/**
 * Scan each `.tsx` file to see if it begins with `'use client'`.
 * Then we know to build them for the client bundle only.
 */
async function detectClientComponents() {
  const allJsx = await collectAppFiles()
  const clientEntryPoints = new Set()

  for (const path of allJsx) {
    const contents = await readFile(path, 'utf-8')
    if (contents.trimStart().startsWith("'use client'")) {
      clientEntryPoints.add(path)
    }
  }

  return Array.from(clientEntryPoints) as string[]
}

/**
 * Build server & client with Bun’s bundler API + plugin usage.
 */
async function buildAll() {
  try {
    // 1) Identify all client components (files with `'use client'`)
    const clientJsxPaths = await detectClientComponents()

    // 2) Build the server component tree
    //    Mark client components as "external" so the server build doesn't bundle them.
    const serverEntry = resolveApp('App.tsx')
    console.log('Building server bundle with entry:', serverEntry)

    const serverResult = await Bun.build({
      entrypoints: [serverEntry],
      outdir: resolveBuild(),
      target: 'bun',
      format: 'esm',
      splitting: false,
      plugins: [
        {
          name: 'server-plugin',
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, async (args) => {
              if (args.path.includes('node_modules')) {
                return undefined
              }

              const isClientPath = clientJsxPaths.find((path) => {
                const relativePath = `./${relative(resolveApp(), path).replace(
                  /\.(jsx|tsx)$/,
                  ''
                )}`
                return args.path === relativePath
              })

              /** TODO: this does not account for import paths with extensions e.g. `./Like.tsx` */
              if (isClientPath) {
                return {
                  external: true,
                  path: args.path,
                }
              }

              return undefined
            })
          },
        },
      ],
    })

    if (serverResult.logs.length) {
      console.warn('Server build logs:', serverResult.logs)
    }

    // 3) Build client components
    //    Add `_client.tsx` as the main entry plus any `'use client'`
    const clientEntries = [resolveApp('_client.tsx'), ...clientJsxPaths]
    console.log('Building client bundle with entries:', clientEntries)

    const clientResult = await Bun.build({
      entrypoints: clientEntries,
      outdir: resolveBuild(),
      target: 'browser',
      format: 'esm',
      splitting: true,
      plugins: [
        // Client-specific plugin to handle transformations
        {
          name: 'client-plugin',
          setup(builder) {
            builder.onLoad({ filter: /\.tsx?$/ }, async (args) => {
              const source = await readFile(args.path, 'utf-8')
              return {
                loader: 'tsx',
                contents: source,
              }
            })
          },
        },
      ],
    })

    if (clientResult.logs.length) {
      console.warn('Client build logs:', clientResult.logs)
    }

    // 4) Inject RSC metadata into client bundles
    await injectClientMetadata(clientResult.outputs)
    console.log('Injected RSC metadata into client bundles.')
  } catch (error) {
    console.error('Error during build process:', error)
    process.exit(1)
  }
}

/**
 * For each built client file:
 *  1. Use `es-module-lexer` to parse named exports
 *  2. Tag them with RSC metadata
 *  3. Populate `clientComponentMap`
 */
async function injectClientMetadata(outputs: BuildArtifact[]) {
  for (const out of outputs) {
    // only process JS files
    if (!/\.(js|mjs)$/.test(out.path)) continue
    const code = await out.text()
    const [, exports] = parse(code)
    let newContents = code

    for (const exp of exports) {
      // Create a unique key from file path + export name
      const key = out.path + exp.n
      clientComponentMap[key] = {
        id: `/build/${relative(resolveBuild(), out.path)}`,
        name: exp.n,
        chunks: [],
        async: true,
      }

      // Add RSC metadata to the file’s export
      newContents += `
${exp.ln}.$$id = ${JSON.stringify(key)};
${exp.ln}.$$typeof = Symbol.for("react.client.reference");
      `
    }

    // Write the updated file (with RSC metadata added)
    await writeFile(out.path, newContents, 'utf-8')
  }
}

// ---------------------------------------------------------------------------
// RSC Handler
// ---------------------------------------------------------------------------
/**
 * Render React Server Components as a readable stream.
 */
async function renderRSC() {
  try {
    const Page = await import('./build/App.js')
    const Component = createElement(Page.default)
    const stream = ReactServerDom.renderToReadableStream(
      Component,
      clientComponentMap
    )
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/x-component',
      },
    })
  } catch (error) {
    console.error('Error rendering RSC:', error)
    return new Response('Internal Server Error', { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// START SERVER
// ---------------------------------------------------------------------------

// 1) Build everything before serving
await buildAll()

Bun.serve({
  port: 3000,
  fetch: async (req) => {
    const url = new URL(req.url)

    // -------------------------------------
    // 1) GET / => Return HTML
    // -------------------------------------
    if (url.pathname === '/' && req.method === 'GET') {
      return new Response(
        `<!DOCTYPE html>
<html>
<head>
  <title>React Server Components using Bun</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/build/_client.js"></script>
</body>
</html>`,
        { headers: { 'Content-Type': 'text/html' } }
      )
    }

    // -------------------------------------
    // 2) GET /rsc => Stream RSC
    // -------------------------------------
    if (url.pathname === '/rsc' && req.method === 'GET') {
      return renderRSC()
    }

    // -------------------------------------
    // 3) Serve /build/* statically
    // -------------------------------------
    if (url.pathname.startsWith('/build/')) {
      const filePath = resolveBuild(url.pathname.replace('/build/', ''))
      try {
        const info = await stat(filePath)
        if (info.isFile()) {
          return new Response(Bun.file(filePath))
        }
      } catch (err) {
        return new Response('Not found', { status: 404 })
      }
    }

    // -------------------------------------
    // 4) Otherwise => 404
    // -------------------------------------
    return new Response('Not found', { status: 404 })
  },
})

console.log('Server listening on http://localhost:3000')
