import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EpisodeStore } from '../lib/episodes.js'
import { FLOWS_INDEX_DISABLED, listFlows } from '../lib/flows.js'
import { SuggestionQueue } from '../lib/store.js'

test('listFlows assembles global/project episodes, patterns and episode proposals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flows-'))
  const project = join(dir, 'project')
  try {
    const store = new EpisodeStore(dir, { projectDirResolver: () => project })
    store.add({ Pattern: 'global-p', Goal: 'global goal' }, { id: '00000001', date: '2026-10-21' })
    store.add({ Pattern: 'project-p', Goal: 'project goal' }, { id: '00000002', date: '2026-10-21', project: true, cwd: '/tmp/x' })
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'PATTERNS.md'), '[id:00000003] [2026-10-21] [summary:pattern]\nPattern: pattern-p\nGoal: pattern goal\n')

    const queue = new SuggestionQueue(join(dir, 'suggestions.jsonl'))
    queue.append({ target: 'memory', content: 'fact', hits: 1 })
    queue.append({ target: 'episode', episode: { Pattern: 'pending-p', Goal: 'pending goal' }, reason: 'why', hits: 1, project: true, branch: 'main' })

    const data = listFlows({ memoryDir: dir, queue, projectDirResolver: () => project, cwd: '/tmp/x' })
    assert.equal(data.episodes.length, 2)
    assert.ok(data.episodes.some((entry) => entry.project === false && entry.fields.Pattern === 'global-p'))
    assert.ok(data.episodes.some((entry) => entry.project === true && entry.fields.Pattern === 'project-p'))
    assert.equal(data.patterns.length, 1)
    assert.equal(data.patterns[0].kind, 'pattern')
    assert.equal(data.pending.length, 1)
    assert.equal(data.pending[0].index, 2, 'the memory proposal occupies queue index 1')
    assert.equal(data.pending[0].episode.Pattern, 'pending-p')
    assert.deepEqual(data.index, { ...FLOWS_INDEX_DISABLED })
    assert.equal(data.partial, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listFlows handles missing files and no cwd', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flows-empty-'))
  try {
    const data = listFlows({ memoryDir: dir })
    assert.deepEqual(data.episodes, [])
    assert.deepEqual(data.patterns, [])
    assert.deepEqual(data.pending, [])
    assert.equal(data.index.enabled, false)
    assert.equal(data.index.tier, 'files')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
