/**
 * check-i18n.mjs — Phase 1 English-first gate.
 *
 * Asserts that the default documentation paths are English, the Chinese
 * mirrors exist, the English quick-start is present, and the host locale
 * default resolves to English. Run with `npm run check:i18n`.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveLocale } from '../lib/i18n.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []

function read(file) {
  try {
    return readFileSync(resolve(root, file), 'utf8')
  } catch {
    problems.push(`missing ${file}`)
    return ''
  }
}

const cjkCount = (text) => (text.match(/[\u3400-\u9fff]/g) ?? []).length
const expectEnglish = (file, text) => {
  const count = cjkCount(text)
  if (count > 40) problems.push(`${file} is not English-first (${count} CJK characters)`)
}
const expectChinese = (file, text) => {
  const count = cjkCount(text)
  if (count < 40) problems.push(`${file} is not Chinese (${count} CJK characters)`)
}

expectEnglish('README.md', read('README.md'))
expectChinese('README.zh.md', read('README.zh.md'))
expectEnglish('docs/CHANGELOG.md', read('docs/CHANGELOG.md'))
expectChinese('docs/CHANGELOG.zh.md', read('docs/CHANGELOG.zh.md'))
expectEnglish('docs/en/rules.md', read('docs/en/rules.md'))
expectEnglish('docs/en/memory-sync.md', read('docs/en/memory-sync.md'))
expectEnglish('docs/en/coi-scheduling.md', read('docs/en/coi-scheduling.md'))
expectChinese('docs/rules.md', read('docs/rules.md'))
expectChinese('docs/COI-调度.md', read('docs/COI-调度.md'))
expectChinese('docs/记忆同步.md', read('docs/记忆同步.md'))
if (!existsSync(resolve(root, 'docs/en/setup.md'))) problems.push('missing docs/en/setup.md')

const savedLocale = process.env.DSH_LOCALE
delete process.env.DSH_LOCALE
const defaultLocale = resolveLocale(undefined)
if (savedLocale !== undefined) process.env.DSH_LOCALE = savedLocale
if (defaultLocale !== 'en') problems.push(`host default locale is ${defaultLocale}, expected en`)

if (problems.length > 0) {
  console.error('i18n gate failed:')
  for (const problem of problems) console.error(`- ${problem}`)
  process.exit(1)
}
console.log('i18n gate: ok')
