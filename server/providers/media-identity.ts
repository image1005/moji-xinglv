import type { PlanEntity } from '../../shared/utils/plan-entities'

const clean = (value: string) => value.normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g, '').trim()
export const mediaNameKey = (value: string) => clean(value).replace(/\s+/g, '').toLocaleLowerCase()
const withoutNotes = (value: string) => clean(value).replace(/\([^()]*\)/g, '').trim()

/** Query normalization never changes the user's plan, entity ID, address or fingerprint. */
export function mediaIdentity(entity: PlanEntity) {
  const city = withoutNotes(entity.city).replace(/市$/, '')
  const original = clean(entity.name)
  const base = withoutNotes(original)
  const names = [original, base]
  if (entity.entityType === 'city') names.unshift(withoutNotes(original))
  if (entity.entityType === 'spot') {
    // For combined visits the chosen component is explicitly shown in the image caption.
    names.push(...base.split(/[·、+]/).map(value => value.trim()).filter(value => value.length >= 2))
  }
  for (const name of [...names]) {
    if (city && name.startsWith(city)) names.push(name.slice(city.length).replace(/^市/, '').trim())
  }
  return { city, names: [...new Set(names.filter(Boolean))].slice(0, 4), primary: base || original }
}

export function matchesWikiTitle(title: string, names: string[], city: string) {
  const local = (value: string) => {
    const key = mediaNameKey(withoutNotes(value))
    const prefix = mediaNameKey(city)
    return prefix && key.startsWith(prefix) && key !== prefix ? key.slice(prefix.length).replace(/^市/, '') : key
  }
  return names.some(name => local(name) === local(title))
}

/** Require a named subject, not merely a search rank. Reject suffixes denoting a different dish. */
export function mentionsMediaSubject(value: string, name: string) {
  const haystack = mediaNameKey(value)
  const needle = mediaNameKey(name)
  let index = haystack.indexOf(needle)
  while (index >= 0) {
    const after = haystack.slice(index + needle.length)
    if (!after || /^[\s\p{P}\p{N}]/u.test(after) || /^(?:之|的|位于|位於|风景|風景|景色|外景|全景|近景|内景|內景|图片|圖片|照片|实拍|實拍|景区|景區|游玩|遊玩|旅游|旅遊|攻略)/.test(after)) return true
    index = haystack.indexOf(needle, index + needle.length)
  }
  return false
}
