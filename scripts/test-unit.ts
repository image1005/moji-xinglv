import { dirname, delimiter } from 'node:path'

// npm-distributed Bun may be reachable only through bun.ps1/bun.cmd on Windows.
// Node workers spawn the native executable, so explicitly expose its directory.
const searchPath = Object.entries(process.env).filter(([key]) => key.toLowerCase() === 'path').map(([, value]) => value).filter(Boolean).join(delimiter)
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'))
env.PATH = [dirname(process.execPath), searchPath].filter(Boolean).join(delimiter)

// Vitest owns its supported Node workers; Bun owns this cross-platform launcher.
const result = Bun.spawn(['node', './node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)], {
  env, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
})
process.exit(await result.exited)
