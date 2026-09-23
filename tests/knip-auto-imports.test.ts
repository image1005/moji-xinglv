import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileAutoImports } from '../scripts/knip-auto-imports'

describe('Nuxt Knip 自动导入适配', () => {
  it('自动导入真正的自由标识符，声明与同名局部变量不能掩盖死导出', async () => {
    const path = resolve('app/utils/scan-fixture.ts')
    expect(await compileAutoImports('const result = formatDateTime(new Date())', path)).toContain('import { formatDateTime }')
    const declaration = 'export function formatDateTime(value: string) { return value }'
    expect(await compileAutoImports(declaration, path)).toBe(declaration)
    const shadow = 'function render(formatDateTime: () => string) { return formatDateTime() }'
    expect(await compileAutoImports(shadow, path)).toBe(shadow)
  })
  it('测试与共享模块不继承 Nuxt 应用全局，Nitro 使用自己的声明映射', async () => {
    const source = 'formatDateTime(new Date())'
    expect(await compileAutoImports(source, resolve('tests/scan-fixture.ts'))).toBe(source)
    expect(await compileAutoImports('requireUser(event)', resolve('server/api/scan-fixture.ts'))).toContain('import { requireUser }')
  })
})
