import { Suspense } from 'react'

import { getAll } from '../data/db.js'
import Like from './Like'

async function Albums() {
  const albums = await getAll()

  return (
    <ul>
      {albums.map((album) => (
        <li
          key={album.id}
          css={{
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
            marginBottom: '0.5rem',
          }}
        >
          <img
            css={{ width: '5rem', aspectRatio: '1 / 1' }}
            src={album.cover}
            alt={album.title}
          />
          <div>
            <h3 css={{ fontSize: '1.25rem' }}>{album.title}</h3>
            <p>{album.songs.length} songs</p>
            {/* TODO: fix Client Components */}
            {/* <Like /> */}
          </div>
        </li>
      ))}
    </ul>
  )
}

export default async function Page() {
  return (
    <>
      <h1 css={{ fontSize: '1.875rem', marginBottom: '0.75rem' }}>Spotifn’t</h1>
      <Suspense fallback="Getting albums">
        <Albums />
      </Suspense>
    </>
  )
}
