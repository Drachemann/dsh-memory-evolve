import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  EPISODE_ID_RE,
  EpisodeError,
  buildEpisodeHead,
  dedupKey,
  formatEpisode,
  isEpisodeId,
  newEpisodeId,
  normalize,
  parseEpisode,
  summaryFor,
  validateEpisodeFields,
} from '../lib/episodes.js'
import {
  autoSummary,
  extractEntryDate,
  parseEntrySummary,
  splitEntryHead,
  stripEntrySummary,
} from '../lib/store.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures', 'episodes')
const entries = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.md') && name !== 'README.md')
  .sort()
  .map((name) => ({ name, text: readFileSync(join(FIXTURES, name), 'utf8').trim() }))

test('the three episode fixtures parse with no tag leaks and round-trip', () => {
  assert.equal(entries.length, 3)
  for (const { name, text } of entries) {
    assert.match(text.split('\n')[0], /^\[id:[0-9a-f]{8}\]/, name)
    const parsed = parseEpisode(text)
    assert.ok(parsed.id !== null && EPISODE_ID_RE.test(parsed.id), name)
    assert.ok(parsed.fields.Pattern, `${name} has no Pattern`)
    assert.ok(parsed.fields.Goal, `${name} has no Goal`)
    assert.equal(parsed.summary, parseEntrySummary(text), name)
    assert.deepEqual(validateEpisodeFields(parsed.fields, { body: parsed.body }), [], name)

    const { head, body } = splitEntryHead(text, 'episode')
    assert.ok(head.startsWith(`[id:${parsed.id}]`), name)
    assert.ok(!/\[(?:id|branch|summary):/.test(body), `${name} leaks a head tag into the body`)
    assert.ok(body.startsWith('Pattern:'), name)
    assert.equal(extractEntryDate(text), parsed.date, name)
    assert.ok(!autoSummary(text).includes('[summary:'), name)
    assert.ok(!stripEntrySummary(text).includes('[summary:'), name)
    assert.ok(stripEntrySummary(text).includes(`[id:${parsed.id}]`), name)
    assert.deepEqual(parsed.unknown, [], name)

    const rendered = formatEpisode(parsed.fields, {
      id: parsed.id,
      date: parsed.date,
      branch: parsed.branch,
      summary: parsed.summary,
    })
    assert.equal(rendered.trim(), text, `${name} does not round-trip`)
  }
})

test('the episode target accepts date-only and date-time heads', () => {
  const dateOnly = '[id:01a9f6ab] [2026-10-20] [branch:main] [summary:one]\nPattern: p\nGoal: g'
  const dateTime = '[id:01a9f6ab] [2026-10-20 14:30] [branch:main] [summary:two]\nPattern: p\nGoal: g'
  for (const entry of [dateOnly, dateTime]) {
    const { head, body } = splitEntryHead(entry, 'episode')
    assert.ok(head.startsWith('[id:01a9f6ab]'))
    assert.ok(body.startsWith('Pattern: p'))
  }
  assert.equal(parseEpisode(dateTime).time, '14:30')
  assert.equal(parseEpisode(dateOnly).time, null)
})

test('the field contract rejects named violations', () => {
  const codes = (fields, opts) => validateEpisodeFields(fields, opts).map((error) => error.code)
  assert.deepEqual(codes({ Pattern: 'P', Goal: 'g' }), ['episode.pattern'])
  assert.ok(codes({ Goal: 'g' }).includes('episode.pattern'))
  assert.ok(codes({ Pattern: 'p' }).includes('episode.goal'))
  assert.ok(codes({ Pattern: 'p', Goal: 'a\nb' }).includes('episode.goal_newline'))
  assert.ok(codes({ Pattern: 'p', Goal: 'a]b' }).includes('episode.summary_required'))
  assert.ok(codes({ Pattern: 'p', Goal: 'g', Confidence: '1.5' }).includes('episode.confidence'))
  assert.ok(codes({ Pattern: 'p', Goal: 'g', Supersedes: 'zzzzzzzz' }).includes('episode.bad_reference'))
  assert.ok(codes({ Pattern: 'p', Goal: 'g', Refs: Array.from({ length: 21 }, (_, i) => `r${i}`).join('; ') }).includes('episode.too_many_refs'))
  assert.ok(codes({ Pattern: 'p', Goal: 'g' }, { body: 'x'.repeat(4097) }).includes('episode.too_large'))
  assert.throws(() => formatEpisode({ Pattern: 'p' }), EpisodeError)
})

test('the dedup key is stable across case and whitespace', () => {
  assert.equal(dedupKey('p', 'Goal  X'), dedupKey('p', '  goal x '))
  assert.notEqual(dedupKey('p', 'Goal X'), dedupKey('q', 'Goal X'))
  assert.equal(normalize('  Hello, World!  '), 'hello, world')
  const summary = summaryFor('A ] B')
  assert.ok(!summary.includes(']'))
  assert.ok(summary.startsWith('A'))
})

test('formatEpisode writes the canonical order and validates', () => {
  const entry = formatEpisode(
    { Pattern: 'p', Goal: 'g]h', Summary: 'safe', Approach: ['a'] },
    { id: 'deadbeef', date: '2026-10-20', branch: 'main' },
  )
  assert.match(entry, /^\[id:deadbeef\] \[2026-10-20\] \[branch:main\] \[summary:safe\]/)
  assert.ok(entry.includes('Pattern: p'))
  assert.ok(entry.includes('Approach:\n- a'))
  assert.throws(() => formatEpisode({ Pattern: 'p', Goal: 'g]h' }), /episode.summary_required/)
})

test('episode ids are eight lowercase hex and avoid taken values', () => {
  const taken = new Set(['00000000'])
  for (let i = 0; i < 50; i += 1) {
    const id = newEpisodeId(taken)
    assert.match(id, /^[0-9a-f]{8}$/)
    taken.add(id)
  }
  assert.equal(isEpisodeId('01a9f6ab'), true)
  assert.equal(isEpisodeId('01A9F6AB'), false)
  assert.equal(isEpisodeId('01a9f6a'), false)
})

test('buildEpisodeHead follows the existing tag order', () => {
  assert.equal(
    buildEpisodeHead({ id: '01a9f6ab', date: '2026-10-20', branch: 'main', summary: 'x' }),
    '[id:01a9f6ab] [2026-10-20] [branch:main] [summary:x]',
  )
})
