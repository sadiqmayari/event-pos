// Runs every *.test.mjs in this folder against an in-memory Postgres (PGlite) with a stub Supabase auth schema.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const dir = path.dirname(fileURLToPath(import.meta.url))
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort()) {
  console.log(`\n=== ${f}`)
  await import(pathToFileURL(path.join(dir, f)).href)
}
