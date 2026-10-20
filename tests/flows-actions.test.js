import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EpisodeStore, dedupKey } from '../lib/episodes.js'
import { archiveFlow, reviseFlow, updateEpisodeProposal } from '../lib/flows.js'
import { SuggestionQueue, parseEntries } from '../lib/store.js'

function temp() {
  return mkdtempSync(join(tmpdir(), 'flows-actions-'))
}

test('updateEpisodeProposal revalidates, recomputes the key and preserves evidence', () => {
  const dir = temp()
  try {
    const queue = new SuggestionQueue(join(dir, 'suggestions.jsonl'))
    queue.append({
      target: 'episode',
      episode: { Pattern: 'old', Goal: 'old goal' },
      reason: 'why',
      hits: 3,
      evidence: 3,
      sources: [{ session_id: 's1' }],
    })
    const result = updateEpisodeProposal(queue, 1, { Pattern: 'new-p', Goal: 'new goal', Approach: ['a'] })
    assert.equal(result.ok, true)
    const [entry] = queue.read()
    assert.equal(entry.episode.Pattern, 'new-p')
    assert.equal(entry.episode.Goal, 'new goal')
    assert.equal(entry.dedup_key, dedupKey('new-p', 'new goal'))
    assert.equal(entry.hits, 3)
    assert.equal(entry.evidence, 3)
    assert.equal(entry.sources.length, 1)
    assert.ok(entry.content.includes('Goal: new goal'))

    const before = JSON.stringify(queue.read())
    const invalid = updateEpisodeProposal(queue, 1, { Goal: 'missing pattern' })
    assert.equal(invalid.ok, false)
    assert.equal(invalid.error.code, 'episode.pattern')
    assert.equal(JSON.stringify(queue.read()), before)

    const wrongIndex = updateEpisodeProposal(queue, 9, { Pattern: 'p', Goal: 'g' })
    assert.equal(wrongIndex.ok, false)
    assert.equal(wrongIndex.error.code, 'episode.not_found')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reviseFlow writes a superseding episode and keeps the original', () => {
  const dir = temp()
  try {
    const store = new EpisodeStore(dir)
    store.add({ Pattern: 'old-p', Goal: 'old goal' }, { id: '00000001', date: '2026-10-20' })
    const result = reviseFlow({
      memoryDir: dir,
      id: '00000001',
      episode: { Pattern: 'new-p', Goal: 'new goal' },
    })
    assert.equal(result.ok, true)
    assert.notEqual(result.id, '00000001')
    const entries = store.list()
    assert.equal(entries.length, 2)
    const revised = entries.find((entry) => entry.id === result.id)
    assert.equal(revised.fields.Supersedes, '00000001')
    assert.equal(store.list().some((entry) => entry.id === '00000001'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('archiveFlow moves the entry to EPISODES-archive.md', () => {
  const dir = temp()
  try {
    const store = new EpisodeStore(dir)
    store.add({ Pattern: 'archive-p', Goal: 'archive goal' }, { id: '00000002', date: '2026-10-20' })
    const result = archiveFlow({ memoryDir: dir, id: '00000002' })
    assert.equal(result.ok, true)
    assert.equal(store.list().length, 0)
    const archived = parseEntries(readFileSync(join(dir, 'EPISODES-archive.md'), 'utf8'))
    assert.equal(archived.length, 1)
    assert.ok(archived[0].includes('[id:00000002]'))
    assert.equal(archiveFlow({ memoryDir: dir, id: '00000002' }).ok, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
