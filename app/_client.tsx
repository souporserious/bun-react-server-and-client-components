import { createRoot } from 'react-dom/client'
// @ts-expect-error
import { createFromFetch } from 'react-server-dom-parcel/client'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

const root = createRoot(rootElement)

/**
 * Fetch server component stream from `/rsc`
 * and render results into the root element as they come in.
 */
createFromFetch(fetch('/rsc')).then((component: React.ReactNode) => {
  root.render(component)
})
