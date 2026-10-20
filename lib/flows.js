/**
 * dsh-memory-evolve — Flows read model.
 *
 * Assembles the Flows surface from the canonical files: confirmed episodes
 * (global + project), pattern notes, and the pending episode proposals. The
 * index is still Phase 3, so the status is truthful: files tier, disabled.
 *
 * Pure and synchronous; the HTTP handler and tests both call it.
 *
 * @module dsh-memory-evolve/flows
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { EpisodeStore, dedupKey, formatEpisode, parseEpisode, validateEpisodeFields } from './episodes.js'
import { parseEntries, todayStamp } from './store.js'

/** The Phase 2 index status: no database is consulted yet. */
export const FLOWS_INDEX_DISABLED = Object.freeze({
  tier: 'files',
  enabled: false,
  degraded: ['index_disabled'],
  database: null,
  extension: null,
  embedding: null,
  rerank: null,
  lastRebuild: null,
  drift: 0,
})

/** Parse PATTERNS.md entries; a missing file reads as empty. */
function readPatternsAt(dir, project) {
  try {
    return parseEntries(readFileSync(join(dir, 'PATTERNS.md'), 'utf8'))
      .map((raw) => ({ ...parseEpisode(raw), project, kind: 'pattern' }))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

/**
 * @param {object} opts
 * @param {string} opts.memoryDir - the memory root.
 * @param {import('./store.js').SuggestionQueue} [opts.queue] - pending proposals.
 * @param {(cwd: string) => string} [opts.projectDirResolver]
 * @param {string|null} [opts.cwd] - the session working directory.
 * @param {boolean} [opts.project=true] - include the project files.
 * @returns {{episodes: object[], patterns: object[], pending: object[], index: object, partial: boolean}}
 */
export function listFlows(opts) {
  const { memoryDir, queue, projectDirResolver, cwd, project = true } = opts
  const store = new EpisodeStore(memoryDir, { projectDirResolver })

  const episodes = store.list().map((entry) => ({ ...entry, project: false, kind: 'episode' }))
  let projectEpisodes = []
  if (project && cwd) {
    try {
      projectEpisodes = store.list({ project: true, cwd }).map((entry) => ({ ...entry, project: true, kind: 'episode' }))
    } catch (error) {
      if (error.code !== 'episode.no_cwd') throw error
    }
  }

  const patterns = readPatternsAt(memoryDir, false)
  if (project && cwd) {
    try {
      patterns.push(...readPatternsAt(store.projectDir(cwd), true))
    } catch (error) {
      if (error.code !== 'episode.no_cwd') throw error
    }
  }

  const pending = queue === undefined || queue === null
    ? []
    : queue.read()
      .map((entry, index) => ({ index: index + 1, ...entry }))
      .filter((entry) => entry.target === 'episode')

  return {
    episodes: [...episodes, ...projectEpisodes],
    patterns,
    pending,
    index: { ...FLOWS_INDEX_DISABLED },
    partial: false,
  }
}

/**
 * Rewrite one pending episode proposal in place: re-validate the fields,
 * recompute `dedup_key` and the preview, and preserve evidence/sources.
 * @param {import('./store.js').SuggestionQueue} queue
 * @param {number} index - 1-based queue index.
 * @param {Record<string, string|string[]>} episode
 * @returns {{ok: boolean, index?: number, entry?: object, error?: object}}
 */
export function updateEpisodeProposal(queue, index, episode) {
  if (!Number.isInteger(index) || index < 1) {
    return { ok: false, error: { code: 'episode.not_found', message: 'Invalid proposal index' } }
  }
  if (episode === null || typeof episode !== 'object' || Array.isArray(episode)) {
    return { ok: false, error: { code: 'episode.invalid', message: 'episode must be an object' } }
  }
  const errors = validateEpisodeFields(episode)
  if (errors.length > 0) return { ok: false, error: errors[0] }
  let content
  try {
    content = formatEpisode(episode, { id: '00000000', date: todayStamp() })
  } catch (error) {
    return { ok: false, error: { code: error.code ?? 'episode.invalid', message: error.message } }
  }
  return queue.mutate((entries) => {
    const entry = entries[index - 1]
    if (!entry || entry.target !== 'episode') {
      return { ok: false, error: { code: 'episode.not_found', message: 'No episode proposal at that index' } }
    }
    entry.episode = episode
    entry.dedup_key = dedupKey(episode.Pattern, episode.Goal)
    entry.content = content
    entry.lastSeen = new Date().toISOString()
    return { ok: true, index, entry }
  })
}

/** Find a confirmed flow by id, globally or in the session's project. */
function findFlow(store, cwd, id) {
  const global = store.list().find((flow) => flow.id === id)
  if (global !== undefined) return { flow: global, project: false }
  if (cwd) {
    try {
      const project = store.list({ project: true, cwd }).find((flow) => flow.id === id)
      if (project !== undefined) return { flow: project, project: true }
    } catch (error) {
      if (error.code !== 'episode.no_cwd') throw error
    }
  }
  return null
}

/**
 * Create a new episode that supersedes `id`. The original stays readable;
 * the new entry is placed where the original lived and inherits its branch.
 * @param {{memoryDir: string, projectDirResolver?: Function, cwd?: string|null, id: string, episode: object}} opts
 * @returns {{ok: boolean, id?: string, file?: string, archived?: string|null, error?: object}}
 */
export function reviseFlow(opts) {
  const { memoryDir, projectDirResolver, cwd, id, episode } = opts
  if (episode === null || typeof episode !== 'object' || Array.isArray(episode)) {
    return { ok: false, error: { code: 'episode.invalid', message: 'episode must be an object' } }
  }
  const store = new EpisodeStore(memoryDir, { projectDirResolver })
  const found = findFlow(store, cwd, id)
  if (found === null) return { ok: false, error: { code: 'episode.not_found', message: `No flow ${id}` } }
  try {
    const result = store.add({ ...episode, Supersedes: id }, {
      project: found.project,
      cwd,
      branch: found.flow.branch,
    })
    return { ok: true, ...result }
  } catch (error) {
    return { ok: false, error: { code: error.code ?? 'episode.invalid', message: error.message } }
  }
}

/**
 * Archive one confirmed flow into EPISODES-archive.md.
 * @param {{memoryDir: string, projectDirResolver?: Function, cwd?: string|null, id: string}} opts
 * @returns {{ok: boolean, id?: string, file?: string, error?: object}}
 */
export function archiveFlow(opts) {
  const { memoryDir, projectDirResolver, cwd, id } = opts
  const store = new EpisodeStore(memoryDir, { projectDirResolver })
  const found = findFlow(store, cwd, id)
  if (found === null) return { ok: false, error: { code: 'episode.not_found', message: `No flow ${id}` } }
  return store.archive(id, { project: found.project, cwd })
}
