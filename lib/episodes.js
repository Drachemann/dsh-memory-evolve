/**
 * dsh-memory-evolve — episode format.
 *
 * Episodes are the "how the work got done" layer: one append-only markdown
 * entry per task episode, stored in `EPISODES.md` (project or global). The
 * entry reuses the existing `§` delimiter and head tags, plus line-prefixed
 * body fields.
 *
 * This module owns the format contract only: parse, validate, format, the
 * normalized dedup key and the eight-hex identity. Storage and approval live
 * in the store/review layers.
 *
 * @module dsh-memory-evolve/episodes
 */

import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  parseEntries,
  parseEntrySummary,
  projectHash,
  scanThreat,
  serializeEntries,
  splitEntryHead,
  todayStamp,
  withLock,
} from './store.js'

/** The episode identity grammar (same as ENTRY_ID_RE). */
export const EPISODE_ID_RE = /^[0-9a-f]{8}$/

/** Pattern slugs are lowercase, digits and hyphens. */
export const EPISODE_PATTERN_RE = /^[a-z0-9-]{1,64}$/

/** One episode body is capped at 4 KB, at most 12 fields and 20 refs. */
export const EPISODE_BODY_LIMIT = 4 * 1024
export const EPISODE_FIELDS_LIMIT = 12
export const EPISODE_REFS_LIMIT = 20
export const EPISODE_GOAL_LIMIT = 300

const SCALAR_FIELDS = new Set([
  'Pattern', 'Confidence', 'Supersedes', 'Goal', 'Summary', 'Correction', 'Reuse when', 'Refs', 'Merged-from',
])
const LIST_FIELDS = new Set(['Approach', 'Worked', 'Failed'])
/** Scalar fields the canonical example writes as a single bullet. */
const BULLET_SCALAR_FIELDS = new Set(['Correction', 'Reuse when'])
const FIELD_ORDER = ['Pattern', 'Confidence', 'Supersedes', 'Goal', 'Approach', 'Worked', 'Failed', 'Correction', 'Reuse when', 'Refs', 'Merged-from']
const FIELD_CANONICAL = new Map(
  [...SCALAR_FIELDS, ...LIST_FIELDS].map((name) => [name.toLowerCase(), name]),
)

/** A named, method-level episode error (the code is the stable contract). */
export class EpisodeError extends Error {
  /**
   * @param {string} code - stable error code, e.g. `episode.pattern`.
   * @param {string} message - human-readable detail.
   * @param {string} [field] - the offending field.
   */
  constructor(code, message, field) {
    super(`${code}: ${message}`)
    this.name = 'EpisodeError'
    this.code = code
    this.field = field
  }
}

/** True when `value` is an eight-hex episode id. */
export function isEpisodeId(value) {
  return EPISODE_ID_RE.test(String(value ?? ''))
}

/**
 * Normalize text for the dedup key: NFKC, lowercase, collapse whitespace,
 * strip leading/trailing punctuation. Pure and locale-independent.
 * @param {string} text
 * @returns {string}
 */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '')
}

/**
 * The stable dedup key for an episode: `sha256(pattern + "\n" + normalize(goal))`.
 * @param {string} pattern
 * @param {string} goal
 * @returns {string} lowercase hex digest.
 */
export function dedupKey(pattern, goal) {
  return createHash('sha256').update(`${String(pattern)}\n${normalize(goal)}`).digest('hex')
}

/**
 * Derive the `[summary:]` text from the goal (or an explicit summary):
 * replace newlines and `]` with spaces, trim, truncate to 80.
 * @param {string} goal
 * @param {string} [explicit]
 * @returns {string}
 */
export function summaryFor(goal, explicit) {
  const source = explicit !== undefined && explicit !== null && String(explicit).trim() !== ''
    ? String(explicit)
    : String(goal ?? '')
  return source.replace(/[\r\n]+/g, ' ').replace(/\]/g, ' ').trim().slice(0, 80)
}

/**
 * Build the head line for an episode. The tag order matches the existing
 * `splitEntryHead` sequence: id, date, branch, summary.
 * @param {{id?: string, date?: string, branch?: string, summary?: string, goal?: string}} meta
 * @returns {string}
 */
export function buildEpisodeHead(meta = {}) {
  const parts = []
  if (meta.id) parts.push(`[id:${meta.id}]`)
  const date = meta.date ?? todayStamp()
  parts.push(`[${date}]`)
  if (meta.branch) parts.push(`[branch:${meta.branch}]`)
  const summary = summaryFor(meta.goal ?? '', meta.summary)
  if (summary) parts.push(`[summary:${summary}]`)
  return parts.join(' ')
}

/**
 * Parse the line-prefixed body fields. Unknown lines are preserved in
 * `unknown` and never dropped. List fields consume `- ` bullets; scalar
 * fields consume continuation lines until the next header or blank line.
 * @param {string} body
 * @returns {{fields: Record<string, string|string[]>, unknown: string[]}}
 */
export function parseEpisodeFields(body) {
  const lines = String(body ?? '').replace(/\r\n/g, '\n').split('\n')
  /** @type {Record<string, string|string[]>} */
  const fields = {}
  const unknown = []
  let current = null
  for (const line of lines) {
    const header = /^([A-Za-z][A-Za-z -]{0,20}):\s?(.*)$/.exec(line)
    if (header !== null) {
      const canonical = FIELD_CANONICAL.get(header[1].toLowerCase())
      if (canonical !== undefined) {
        current = canonical
        if (LIST_FIELDS.has(canonical)) fields[canonical] = []
        else fields[canonical] = header[2].trim()
        continue
      }
    }
    if (current !== null && LIST_FIELDS.has(current)) {
      const bullet = /^\s*-\s+(.*)$/.exec(line)
      if (bullet !== null) {
        fields[current].push(bullet[1].trim())
        continue
      }
      if (line.trim() === '') continue
      unknown.push(line)
      continue
    }
    if (current !== null && SCALAR_FIELDS.has(current)) {
      if (line.trim() === '') { current = null; continue }
      const bullet = /^\s*-\s+(.*)$/.exec(line)
      const value = bullet !== null ? bullet[1].trim() : line.trim()
      fields[current] = `${fields[current]} ${value}`.trim()
      continue
    }
    if (line.trim() !== '') unknown.push(line)
  }
  return { fields, unknown }
}

/**
 * Validate an episode's fields against the contract. Returns a list of
 * named errors instead of throwing, so callers can show every problem.
 * @param {Record<string, string|string[]>} fields
 * @param {{body?: string}} [opts]
 * @returns {{code: string, field?: string, message: string}[]}
 */
export function validateEpisodeFields(fields, opts = {}) {
  /** @type {{code: string, field?: string, message: string}[]} */
  const errors = []
  const pattern = String(fields.Pattern ?? '')
  if (pattern === '') errors.push({ code: 'episode.pattern', field: 'Pattern', message: 'Pattern is required' })
  else if (!EPISODE_PATTERN_RE.test(pattern)) {
    errors.push({ code: 'episode.pattern', field: 'Pattern', message: 'Pattern must match [a-z0-9-]{1,64}' })
  }

  const goal = String(fields.Goal ?? '')
  if (goal === '') errors.push({ code: 'episode.goal', field: 'Goal', message: 'Goal is required' })
  else {
    if (goal.length > EPISODE_GOAL_LIMIT) {
      errors.push({ code: 'episode.goal', field: 'Goal', message: `Goal exceeds ${EPISODE_GOAL_LIMIT} characters` })
    }
    if (/[\r\n]/.test(goal)) {
      errors.push({ code: 'episode.goal_newline', field: 'Goal', message: 'Goal must be one line' })
    }
    if (goal.includes(']') && String(fields.Summary ?? '') === '') {
      errors.push({ code: 'episode.summary_required', field: 'Summary', message: 'Goal contains ] so an explicit Summary is required' })
    }
  }

  if (fields.Confidence !== undefined && String(fields.Confidence).trim() !== '') {
    const confidence = Number(fields.Confidence)
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      errors.push({ code: 'episode.confidence', field: 'Confidence', message: 'Confidence must be a number from 0 to 1' })
    }
  }

  for (const field of ['Supersedes', 'Merged-from']) {
    if (fields[field] === undefined || String(fields[field]).trim() === '') continue
    const raw = String(fields[field])
    const ids = field === 'Merged-from'
      ? raw.split(',').map((s) => s.trim()).filter(Boolean)
      : [raw.trim()]
    for (const id of ids) {
      if (!isEpisodeId(id)) {
        errors.push({ code: 'episode.bad_reference', field, message: `${field} must be eight lowercase hex characters` })
      }
    }
  }

  const refs = fields.Refs === undefined
    ? []
    : Array.isArray(fields.Refs)
      ? fields.Refs
      : String(fields.Refs).split(';').map((s) => s.trim()).filter(Boolean)
  if (refs.length > EPISODE_REFS_LIMIT) {
    errors.push({ code: 'episode.too_many_refs', field: 'Refs', message: `At most ${EPISODE_REFS_LIMIT} refs` })
  }

  const fieldCount = Object.keys(fields).filter((key) => key !== 'Summary').length
  if (fieldCount > EPISODE_FIELDS_LIMIT) {
    errors.push({ code: 'episode.too_many_fields', message: `At most ${EPISODE_FIELDS_LIMIT} body fields` })
  }

  if (opts.body !== undefined && Buffer.byteLength(String(opts.body), 'utf8') > EPISODE_BODY_LIMIT) {
    errors.push({ code: 'episode.too_large', message: `Body exceeds ${EPISODE_BODY_LIMIT} bytes` })
  }

  return errors
}

/**
 * Throw the first validation error as an `EpisodeError`.
 * @param {Record<string, string|string[]>} fields
 * @param {{body?: string}} [opts]
 */
export function assertEpisode(fields, opts = {}) {
  const errors = validateEpisodeFields(fields, opts)
  if (errors.length > 0) {
    const first = errors[0]
    throw new EpisodeError(first.code, first.message, first.field)
  }
}

/**
 * Render one canonical episode entry. Throws `EpisodeError` when invalid.
 * @param {Record<string, string|string[]>} fields
 * @param {{id?: string, date?: string, branch?: string, summary?: string}} [meta]
 * @returns {string} head line, newline, body.
 */
export function formatEpisode(fields, meta = {}) {
  assertEpisode(fields)
  const lines = []
  for (const name of FIELD_ORDER) {
    const value = fields[name]
    if (value === undefined || value === null || value === '') continue
    if (LIST_FIELDS.has(name)) {
      const items = Array.isArray(value) ? value : [value]
      if (items.length === 0) continue
      lines.push(`${name}:`)
      for (const item of items) lines.push(`- ${item}`)
    } else if (BULLET_SCALAR_FIELDS.has(name)) {
      const items = Array.isArray(value) ? value : [value]
      lines.push(`${name}:`)
      for (const item of items) lines.push(`- ${item}`)
    } else if (name === 'Refs') {
      const refs = Array.isArray(value) ? value : String(value).split(';').map((s) => s.trim()).filter(Boolean)
      if (refs.length > 0) lines.push(`Refs: ${refs.join('; ')}`)
    } else if (name === 'Merged-from') {
      const ids = Array.isArray(value) ? value : String(value).split(',').map((s) => s.trim()).filter(Boolean)
      if (ids.length > 0) lines.push(`Merged-from: ${ids.join(', ')}`)
    } else {
      lines.push(`${name}: ${String(value).trim()}`)
    }
  }
  const body = lines.join('\n')
  assertEpisode(fields, { body })
  const summary = meta.summary ?? fields.Summary ?? summaryFor(String(fields.Goal ?? ''))
  const head = buildEpisodeHead({ ...meta, summary, goal: String(fields.Goal ?? '') })
  return `${head}\n${body}`
}

/**
 * Parse one canonical episode entry. Invalid entries still parse; the write
 * path calls `assertEpisode` before persisting.
 * @param {string} entry
 * @returns {{id: string|null, date: string|null, time: string|null, branch: string|null, summary: string|null, fields: Record<string, string|string[]>, unknown: string[], head: string, body: string}}
 */
export function parseEpisode(entry) {
  const text = String(entry ?? '')
  const { head, body } = splitEntryHead(text, 'episode')
  const idMatch = /\[id:([0-9a-f]{8})\]/.exec(head)
  const dateMatch = /\[(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}(?::\d{2})?))?\]/.exec(head)
  const branchMatch = /\[branch:([^\]]*)\]/.exec(head)
  const { fields, unknown } = parseEpisodeFields(body)
  return {
    id: idMatch ? idMatch[1] : null,
    date: dateMatch ? dateMatch[1] : null,
    time: dateMatch && dateMatch[2] ? dateMatch[2] : null,
    branch: branchMatch ? branchMatch[1] : null,
    summary: parseEntrySummary(text),
    fields,
    unknown,
    head,
    body,
  }
}

/**
 * Generate a fresh eight-hex id, avoiding ids already in `taken`.
 * @param {Set<string>|Iterable<string>} [taken]
 * @returns {string}
 */
export function newEpisodeId(taken = new Set()) {
  const used = taken instanceof Set ? taken : new Set(taken)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = randomBytes(4).toString('hex')
    if (!used.has(id)) return id
  }
  throw new EpisodeError('episode.id_exhausted', 'Could not allocate a unique episode id')
}

/** Confirmed episodes per file before the lowest-ranked is archived. */
export const EPISODE_CAP = 200

/**
 * The eviction score: `0.6 * recency(date, 90d) + 0.4 * confidence`.
 * Device-local signals (`last_used_at`, feedback delta) are deliberately
 * absent so two devices archive the same entry.
 * @param {{date?: string|null, fields: Record<string, string|string[]>}} parsed
 * @param {number} [now] - the instant to score against (one per eviction, so
 *   every candidate sees the same clock; a per-entry `Date.now()` would make
 *   the ranking depend on millisecond boundaries).
 * @returns {number}
 */
export function episodeScore(parsed, now = Date.now()) {
  const stamp = parsed?.date ? Date.parse(parsed.date) : Number.NaN
  const ageDays = Number.isFinite(stamp) ? Math.max(0, (now - stamp) / 86_400_000) : 90
  const recency = Math.max(0, 1 - Math.min(ageDays / 90, 1))
  const confidence = Number(parsed?.fields?.Confidence ?? 0.5)
  return 0.6 * recency + 0.4 * (Number.isFinite(confidence) ? confidence : 0.5)
}

/**
 * Append-only episode store. One `EPISODES.md` per project directory, one
 * global file at the memory root; the cap moves the lowest-ranked confirmed
 * episode to `EPISODES-archive.md`, never deletes it.
 */
export class EpisodeStore {
  /**
   * @param {string} dir - the memory directory.
   * @param {{projectDirResolver?: (cwd: string) => string}} [options]
   */
  constructor(dir, options = {}) {
    this.dir = dir
    this.projectDirResolver = typeof options.projectDirResolver === 'function' ? options.projectDirResolver : null
  }

  /** Resolve a project directory (requires a cwd). */
  projectDir(cwd) {
    if (!cwd) throw new EpisodeError('episode.no_cwd', 'A project episode needs a working directory')
    return this.projectDirResolver ? this.projectDirResolver(cwd) : join(this.dir, 'projects', projectHash(cwd))
  }

  /** The main episode file for a project or the global root. */
  fileOf(opts = {}) {
    return opts.project === true ? join(this.projectDir(opts.cwd), 'EPISODES.md') : join(this.dir, 'EPISODES.md')
  }

  /** The archive file beside the main episode file. */
  archiveFileOf(opts = {}) {
    return join(dirname(this.fileOf(opts)), 'EPISODES-archive.md')
  }

  /** Raw entries (missing file reads as empty). */
  read(opts = {}) {
    try {
      return parseEntries(readFileSync(this.fileOf(opts), 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }

  /** Parsed episodes. */
  list(opts = {}) {
    return this.read(opts).map((entry) => parseEpisode(entry))
  }

  /**
   * Append one episode. Throws `EpisodeError` on invalid fields, a reused id,
   * an injection pattern, or a missing project cwd.
   * @param {Record<string, string|string[]>} fields
   * @param {{id?: string, date?: string, branch?: string, summary?: string, project?: boolean, cwd?: string}} [meta]
   * @returns {{ok: boolean, duplicate?: boolean, id: string, file: string, archived?: string|null, superseded?: string|null}}
   */
  add(fields, meta = {}) {
    assertEpisode(fields)
    const opts = { project: meta.project === true, cwd: meta.cwd }
    const file = this.fileOf(opts)
    const archive = this.archiveFileOf(opts)
    return withLock(dirname(file), () => {
      const entries = this.read(opts)
      const parsed = entries.map((entry) => parseEpisode(entry))
      const ids = new Set(parsed.map((item) => item.id).filter(Boolean))
      const id = meta.id ?? newEpisodeId(ids)
      if (ids.has(id)) throw new EpisodeError('episode.id_taken', `Episode id ${id} is already in use`)

      // Dedup only when this is not a correction. A correction carries
      // Supersedes and must be allowed to share the pattern+goal key.
      if (!fields.Supersedes) {
        const key = dedupKey(fields.Pattern, fields.Goal)
        const existing = parsed.find((item) => item.fields.Pattern !== undefined
          && item.fields.Goal !== undefined
          && dedupKey(item.fields.Pattern, item.fields.Goal) === key)
        if (existing) return { ok: true, duplicate: true, id: existing.id, file }
      }

      const date = meta.date ?? todayStamp()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
        throw new EpisodeError('episode.bad_date', `Episode date must be YYYY-MM-DD, got ${date}`)
      }
      const entry = formatEpisode(fields, { id, date, branch: meta.branch, summary: meta.summary ?? fields.Summary })
      const threat = scanThreat(entry)
      if (threat) throw new EpisodeError('episode.injection', threat)

      const next = [...entries, entry]
      const superseded = new Set(parsed.map((item) => item.fields.Supersedes).filter(Boolean))
      if (fields.Supersedes) superseded.add(fields.Supersedes)
      const confirmed = next
        .map((raw) => parseEpisode(raw))
        .filter((item) => item.id && !superseded.has(item.id))
      let archived = null
      if (confirmed.length > EPISODE_CAP) {
        const now = Date.now()
        const victim = confirmed
          .map((item) => ({ item, score: episodeScore(item, now) }))
          .sort((a, b) => a.score - b.score || String(a.item.id).localeCompare(String(b.item.id)))[0].item
        const victimRaw = next.find((raw) => parseEpisode(raw).id === victim.id)
        if (victimRaw !== undefined) {
          archived = victim.id
          next.splice(next.indexOf(victimRaw), 1)
          let archiveEntries = []
          try {
            archiveEntries = parseEntries(readFileSync(archive, 'utf8'))
          } catch (error) {
            if (error.code !== 'ENOENT') throw error
          }
          mkdirSync(dirname(archive), { recursive: true })
          writeFileSync(archive, serializeEntries([...archiveEntries, victimRaw]))
        }
      }
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, serializeEntries(next))
      return { ok: true, id, file, archived, superseded: fields.Supersedes ?? null }
    })
  }

  /**
   * Move one confirmed episode out of EPISODES.md into EPISODES-archive.md.
   * Never deletes the text; returns `episode.not_found` when the id is absent.
   * @param {string} id - eight-hex episode id.
   * @param {{project?: boolean, cwd?: string}} [opts]
   * @returns {{ok: boolean, id?: string, file?: string, error?: {code: string, message: string}}}
   */
  archive(id, opts = {}) {
    const file = this.fileOf(opts)
    const archive = this.archiveFileOf(opts)
    return withLock(dirname(file), () => {
      const entries = this.read(opts)
      const victim = entries.find((raw) => parseEpisode(raw).id === id)
      if (victim === undefined) {
        return { ok: false, error: { code: 'episode.not_found', message: `No episode ${id}` } }
      }
      const rest = entries.filter((raw) => raw !== victim)
      let archiveEntries = []
      try {
        archiveEntries = parseEntries(readFileSync(archive, 'utf8'))
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      mkdirSync(dirname(archive), { recursive: true })
      writeFileSync(archive, serializeEntries([...archiveEntries, victim]))
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, serializeEntries(rest))
      return { ok: true, id, file: archive }
    })
  }
}
