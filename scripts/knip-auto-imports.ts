import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { createUnimport, type Import } from 'unimport'
import { parseSync } from 'oxc-parser'

// Knip 6.37's Nuxt TS compiler counts declaration names as auto-import uses,
// even importing a file's exports from itself. Use Nuxt's own unimport engine
// for TS files; retain Knip's mature Vue/template/Nitro entry handling.
const compilers = new Map<string, ReturnType<typeof createUnimport>>()
for (const file of ['.nuxt/imports.d.ts', '.nuxt/types/nitro-imports.d.ts']) {
  const imports: Import[] = []
  const fullPath = resolve(file)
  const source = readFileSync(fullPath, 'utf8')
  const add = (name: string, from: string, as = name) => {
    if (!from.startsWith('.') || from.includes('node_modules')) return
    imports.push({ name, as, from: resolve(dirname(fullPath), from).replaceAll('\\', '/') })
  }
  for (const node of parseSync(file, source).program.body) {
    if (node.type === 'ExportNamedDeclaration' && node.source) {
      for (const item of node.specifiers) {
        const name = item.local.type === 'Identifier' ? item.local.name : String(item.local.value)
        const alias = item.exported.type === 'Identifier' ? item.exported.name : String(item.exported.value)
        add(name, node.source.value, alias)
      }
    }
  }
  // Nitro's generated declarations use this stable typeof-import shape.
  for (const match of source.matchAll(/const (\w+): typeof import\(['"]([^'"]+)['"]\)\.(\w+)/g)) add(match[3]!, match[2]!, match[1]!)
  compilers.set(file.includes('nitro-') ? 'server' : 'app', createUnimport({ imports, parser: 'oxc' }))
}

export async function compileAutoImports(source: string, path: string): Promise<string> {
  if (path.endsWith('.d.ts') || path.endsWith('.config.ts')) return source
  const autoImports = compilers.get(relative(process.cwd(), path).replaceAll('\\', '/').split('/')[0]!)
  if (!autoImports) return source
  return (await autoImports.injectImports(source, path)).code
}
