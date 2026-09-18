import { afterEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import type { LanguageModelV2Prompt } from '@ai-sdk/provider'
import { boundModelPrompt } from '../server/agents/model-budget'

afterEach(() => vi.unstubAllEnvs())
it('真实较大图片保留完整字节，独立于96KiB文字预算', async () => {
  const pixels = new Uint8Array(512 * 512 * 3)
  crypto.getRandomValues(pixels.subarray(0, 65536))
  for (let i = 65536; i < pixels.length; i += 65536) crypto.getRandomValues(pixels.subarray(i, Math.min(pixels.length, i + 65536)))
  const image = await sharp(pixels, { raw: { width: 512, height: 512, channels: 3 } }).png().toBuffer()
  expect(image.byteLength).toBeGreaterThan(96000)
  const prompt: LanguageModelV2Prompt = [{ role: 'user', content: [{ type: 'text', text: '根据景点照片规划旅行' }, { type: 'file', mediaType: 'image/png', data: new Uint8Array(image) }] }]
  const bounded = boundModelPrompt(prompt, 12000, 96000)
  expect(bounded).toEqual(prompt)
  const inline = new URL(`data:image/png;base64,${image.toString('base64')}`)
  const normalizedPrompt: LanguageModelV2Prompt = [{ role: 'user', content: [{ type: 'file', mediaType: 'image/png', data: inline }] }]
  const normalized = boundModelPrompt(normalizedPrompt, 12000, 96000)
  expect(normalized).toEqual(normalizedPrompt)
  expect((normalized[0]!.content as { data: URL }[])[0]!.data).toBeInstanceOf(URL)
  vi.stubEnv('AI_INPUT_MAX_IMAGES', '1')
  expect(() => boundModelPrompt([...prompt, ...prompt], 12000, 96000)).toThrow('图片超过模型输入预算')
  expect(() => boundModelPrompt([{ role: 'user', content: [{ type: 'text', text: '旅行'.repeat(50000) }, { type: 'file', mediaType: 'image/png', data: new Uint8Array(image) }] }], 12000, 96000)).toThrow('超过 AI 输入预算')
})
