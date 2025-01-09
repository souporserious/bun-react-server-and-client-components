import React from 'react'

import { Button } from './Button'

export function App(props: { message: string }) {
  return (
    <html>
      <body>
        <h1>{props.message}</h1>
        <Button />
      </body>
    </html>
  )
}
