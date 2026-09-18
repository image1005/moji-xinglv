import type { KnipConfig } from 'knip'
import { compileAutoImports } from './scripts/knip-auto-imports'

/** Nuxt 4 entries and auto-import references come from Knip's Nuxt plugin.
 * Run nuxt prepare first: .nuxt/imports.d.ts and components.d.ts are reference
 * maps, not blanket application entry points.
 */
const config: KnipConfig = {
  // CLI administration programs are actual deployed operations, not app source roots.
  entry: ['server/database/migrate.ts!', 'server/database/seed.ts!'],
  project: ['app/**/*.{ts,vue,scss}!', 'server/**/*.ts!', 'shared/**/*.ts!', 'scripts/**/*.ts', 'tests/**/*.ts', 'evals/**/*.ts', '*.config.{ts,mjs}'],
  // Runtime/CLI resolution not represented by JS imports. Keep this list exact.
  ignoreDependencies: ['nuxt', 'vue-tsc', 'github-markdown-css'],
  compilers: { ts: compileAutoImports },
  paths: {
    '~/*': ['./app/*'],
    '@/*': ['./app/*'],
    '~~/*': ['./*'],
    '@@/*': ['./*'],
    '#shared/*': ['./shared/*'],
  },
}

export default config
