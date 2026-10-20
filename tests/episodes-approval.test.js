import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MemoryStore, SuggestionQueue, parseEntries } from '../lib/store.js'
import { approveSuggestions, suggestToolDefinition } from '../lib/review.js'
import { parseEpisode } from '../lib/episodes.js'

const temp = () => mkdtempSync(join(tmpdir(), 'episodes-approval-'))
const agent = { id: 's1', session: { header: { cwd: '/tmp/work' } } }
const episode = {
  Pattern: 'p-approval',
  Goal: 'Approve an episode through the review queue.',
  Approach: ['a'],
  Worked: ['w'],
  Failed: ['f'],
  Correction: 'c',
  'Reuse when': 'r',
  Refs: ['x'],
}

test('memory_suggest queues an episode and approval writes the project file', async () => {
  const dir = temp()
  const project = join(dir, 'project')
  try {
    const queue = new SuggestionQueue(join(dir, 'SUGGESTIONS.jsonl'))
    const tool = suggestToolDefinition({ suggestToolName: 'memory_suggest' }, queue)
    const queued = await tool.execute({ target: 'episode', reason: 'the session showed it', episode }, { agent })
    assert.equal(queued.ok, true)
    const pending = queue.read()
    assert.equal(pending.length, 1)
    assert.equal(pending[0].target, 'episode')
    assert.equal(pending[0].episode.Pattern, episode.Pattern)
    assert.ok(pending[0].dedup_key)
    assert.equal(pending[0].project, true)

    const store = new MemoryStore(dir, { projectDirResolver: () => project })
    const report = approveSuggestions(store, {}, queue, [1], agent)
    assert.ok(report.lines.length > 0)
    assert.equal(queue.read().length, 0)
    const file = join(project, 'EPISODES.md')
    assert.equal(existsSync(file), true)
    const written = parseEntries(readFileSync(file, 'utf8')).map(parseEpisode)
    assert.equal(written.length, 1)
    assert.equal(written[0].fields.Pattern, episode.Pattern)
    assert.match(written[0].id, /^[0-9a-f]{8}$/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a repeated episode suggestion bumps evidence instead of stacking', async () => {
  const dir = temp()
  try {
    const queue = new SuggestionQueue(join(dir, 'SUGGESTIONS.jsonl'))
    const tool = suggestToolDefinition({ suggestToolName: 'memory_suggest' }, queue)
    await tool.execute({ target: 'episode', reason: 'first', episode }, { agent })
    await tool.execute({ target: 'episode', reason: 'second', episode }, { agent })
    const pending = queue.read()
    assert.equal(pending.length, 1)
    assert.equal(pending[0].hits, 2)
    assert.equal(pending[0].evidence, 2)
    assert.equal(pending[0].sources.length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('project=false writes the global episode file', async () => {
  const dir = temp()
  try {
    const queue = new SuggestionQueue(join(dir, 'SUGGESTIONS.jsonl'))
    const tool = suggestToolDefinition({ suggestToolName: 'memory_suggest' }, queue)
    await tool.execute({ target: 'episode', reason: 'global flow', project: false, episode }, { agent })
    const store = new MemoryStore(dir)
    approveSuggestions(store, {}, queue, [1], agent)
    assert.equal(existsSync(join(dir, 'EPISODES.md')), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the episode target rejects missing fields without queueing', async () => {
  const dir = temp()
  try {
    const queue = new SuggestionQueue(join(dir, 'SUGGESTIONS.jsonl'))
    const tool = suggestToolDefinition({ suggestToolName: 'memory_suggest' }, queue)
    const outcome = await tool.execute({ target: 'episode', reason: 'why', episode: { Goal: 'g' } }, { agent })
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /episode\.pattern|invalid episode/)
    assert.equal(queue.read().length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an explicit Summary makes a goal containing ] acceptable', async () => {
  const dir = temp()
  try {
    const queue = new SuggestionQueue(join(dir, 'SUGGESTIONS.jsonl'))
    const tool = suggestToolDefinition({ suggestToolName: 'memory_suggest' }, queue)
    const outcome = await tool.execute(
      { target: 'episode', reason: 'bracket goal', episode: { Pattern: 'p-bracket', Goal: 'a]b', Summary: 'safe' } },
      { agent },
    )
    assert.equal(outcome.ok, true)
    assert.equal(queue.read()[0].episode.Summary, 'safe')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('content is still required for fact targets and reason for every target', async () => {
  const dir = temp()
  try {
    const queue = new SuggestionQueue(join(dir, 'SUGGESTIONS.jsonl'))
    const tool = suggestToolDefinition({ suggestToolName: 'memory_suggest' }, queue)
    assert.equal((await tool.execute({ target: 'memory', reason: 'why' }, { agent })).ok, false)
    assert.equal((await tool.execute({ target: 'episode', episode }, { agent })).ok, false)
    assert.equal(queue.read().length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
