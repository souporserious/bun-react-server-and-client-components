import React from 'react'
import { renderToReadableStream } from 'react-dom/server'

await Bun.build({
  entrypoints: ['./client.tsx'],
  outdir: './build',
})

Bun.serve({
  async fetch(req) {
    const url = new URL(req.url)

    // Serve the client-side JavaScript bundle
    if (url.pathname === '/client.js') {
      const clientPath = `${import.meta.dirname}/build/client.js`
      try {
        const file = Bun.file(clientPath)
        return new Response(await file.arrayBuffer(), {
          headers: {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'no-store',
          },
        })
      } catch (error) {
        return new Response('Client script not found.', { status: 404 })
      }
    }

    // Handle main route
    if (url.pathname === '/') {
      const { App } = await import('./App.tsx')
      const stream = await renderToReadableStream(
        <App message="Hello World" />,
        { bootstrapScripts: ['/client.js'] }
      )
      return new Response(stream, {
        headers: { 'Content-Type': 'text/html' },
      })
    }

    return new Response('Not Found', { status: 404 })
  },
})
