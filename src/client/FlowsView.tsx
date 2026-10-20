/**
 * Flows view — the curation surface for episodes and pattern notes.
 *
 * A master-detail panel: pending proposals on top, confirmed flows on the
 * left, the selected flow's fields/history/why-recalled on the right, and a
 * collapsible index-status footer. Phase 2 reads the canonical files; the
 * index status is truthfully "files" until Phase 3.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

interface FlowFields {
  Pattern?: string
  Goal?: string
  Summary?: string
  Confidence?: string | number
  Approach?: string[]
  Worked?: string[]
  Failed?: string[]
  Correction?: string
  'Reuse when'?: string
  Refs?: string[]
  Supersedes?: string
  'Merged-from'?: string[]
}

interface FlowRecord {
  id: string | null
  date: string | null
  time: string | null
  branch: string | null
  summary: string | null
  fields: FlowFields
  project: boolean
  kind: 'episode' | 'pattern'
}

interface PendingRecord {
  index: number
  episode?: FlowFields
  content?: string
  reason?: string | null
  hits?: number
  time?: string
  project?: boolean
  branch?: string | null
}

interface IndexStatus {
  tier: string
  enabled: boolean
  degraded: string[]
  database: string | null
  embedding: string | null
  rerank: string | null
  lastRebuild: string | null
  drift: number
}

interface FlowsData {
  episodes: FlowRecord[]
  patterns: FlowRecord[]
  pending: PendingRecord[]
  index: IndexStatus
  partial: boolean
}

export interface FlowsViewProps {
  sessionId: string
  t: Translate
  onChanged?: () => void
}

interface Filters {
  project: 'all' | 'project' | 'global'
  branch: string
  pattern: string
  confidence: number
}

const EMPTY_FILTERS: Filters = { project: 'all', branch: 'all', pattern: '', confidence: 0 }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/memory-evolve${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

const confidenceOf = (flow: FlowRecord): number => {
  const value = Number(flow.fields.Confidence ?? 0.5)
  return Number.isFinite(value) ? value : 0.5
}

interface Draft {
  Pattern: string
  Goal: string
  Confidence: string
  Approach: string
  Worked: string
  Failed: string
  Correction: string
  'Reuse when': string
  Refs: string
}

const toDraft = (fields?: FlowFields): Draft => ({
  Pattern: String(fields?.Pattern ?? ''),
  Goal: String(fields?.Goal ?? ''),
  Confidence: String(fields?.Confidence ?? '0.5'),
  Approach: (fields?.Approach ?? []).join('\n'),
  Worked: (fields?.Worked ?? []).join('\n'),
  Failed: (fields?.Failed ?? []).join('\n'),
  Correction: String(fields?.Correction ?? ''),
  'Reuse when': String(fields?.['Reuse when'] ?? ''),
  Refs: (fields?.Refs ?? []).join('; '),
})

const fromDraft = (draft: Draft): FlowFields => {
  const lines = (value: string): string[] => value.split('\n').map((line) => line.trim()).filter(Boolean)
  const refs = (value: string): string[] => value.split(';').map((part) => part.trim()).filter(Boolean)
  const confidence = Number(draft.Confidence)
  return {
    Pattern: draft.Pattern.trim(),
    Goal: draft.Goal.trim(),
    Confidence: Number.isFinite(confidence) ? confidence : 0.5,
    Approach: lines(draft.Approach),
    Worked: lines(draft.Worked),
    Failed: lines(draft.Failed),
    Correction: draft.Correction.trim(),
    'Reuse when': draft['Reuse when'].trim(),
    Refs: refs(draft.Refs),
  }
}

const draftLabel = (key: keyof Draft, t: Translate): string => {
  if (key === 'Pattern') return t('flows.filter.pattern')
  if (key === 'Goal') return t('flows.goal')
  if (key === 'Confidence') return t('flows.filter.confidence')
  if (key === 'Approach') return t('flows.approach')
  if (key === 'Worked') return t('flows.worked')
  if (key === 'Failed') return t('flows.failed')
  if (key === 'Correction') return t('flows.correction')
  if (key === 'Reuse when') return t('flows.reuse')
  return t('flows.refs')
}

/** One filtered/sorted row in the confirmed list. */
function FlowRow({ flow, active, t, onSelect }: { flow: FlowRecord; active: boolean; t: Translate; onSelect: () => void }): JSX.Element {
  const pattern = String(flow.fields.Pattern ?? '')
  const goal = String(flow.fields.Goal ?? flow.summary ?? '')
  return (
    <button
      type="button"
      className={active ? 'flows-list-row flows-list-row-active' : 'flows-list-row'}
      onClick={onSelect}
    >
      <span className="flows-list-title">
        <span className="flows-badge">{flow.kind === 'pattern' ? t('flows.kind.pattern') : t('flows.kind.episode')}</span>
        {pattern || goal}
      </span>
      <span className="flows-list-meta">
        {pattern && <span>{pattern}</span>}
        <span>{t('flows.confidence', { value: confidenceOf(flow).toFixed(2) })}</span>
        {flow.branch && <span>{flow.branch}</span>}
        <span>{flow.project ? t('flows.filter.projectOnly') : t('flows.filter.global')}</span>
      </span>
    </button>
  )
}

export function FlowsView({ sessionId, t, onChanged }: FlowsViewProps): JSX.Element {
  const [data, setData] = useState<FlowsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [pendingOpen, setPendingOpen] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [editor, setEditor] = useState<{ kind: 'pending'; index: number } | { kind: 'flow'; id: string } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback((): void => {
    setLoading(true)
    setError(null)
    void api<FlowsData>(`/api/flows?sessionId=${encodeURIComponent(sessionId)}`)
      .then((res) => {
        setData(res)
        setSelected((current) => {
          if (current === null) return null
          const all = [...res.episodes, ...res.patterns]
          return all.some((flow) => flow.id === current) ? current : null
        })
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false))
  }, [sessionId])

  useEffect(() => {
    load()
  }, [load])

  const flows = useMemo(
    () => [...(data?.episodes ?? []), ...(data?.patterns ?? [])],
    [data],
  )
  const pending = data?.pending ?? []

  const branches = useMemo(
    () => Array.from(new Set(flows.map((flow) => flow.branch).filter((branch): branch is string => typeof branch === 'string' && branch.length > 0))).sort(),
    [flows],
  )

  const filtered = useMemo(() => flows.filter((flow) => {
    if (filters.project === 'project' && !flow.project) return false
    if (filters.project === 'global' && flow.project) return false
    if (filters.branch !== 'all' && flow.branch !== filters.branch) return false
    if (filters.pattern.trim() !== '') {
      const pattern = String(flow.fields.Pattern ?? '').toLowerCase()
      if (!pattern.includes(filters.pattern.trim().toLowerCase())) return false
    }
    return confidenceOf(flow) >= filters.confidence
  }), [flows, filters])

  const selectedFlow = flows.find((flow) => flow.id === selected) ?? null

  const activeFilters: { key: string; label: string }[] = []
  if (filters.project !== 'all') {
    activeFilters.push({
      key: 'project',
      label: filters.project === 'project' ? t('flows.filter.projectOnly') : t('flows.filter.global'),
    })
  }
  if (filters.branch !== 'all') activeFilters.push({ key: 'branch', label: filters.branch })
  if (filters.pattern.trim() !== '') activeFilters.push({ key: 'pattern', label: filters.pattern.trim() })
  if (filters.confidence > 0) activeFilters.push({ key: 'confidence', label: t('flows.confidence', { value: filters.confidence.toFixed(2) }) })

  const clearFilter = (key: string): void => {
    setFilters((current) => {
      if (key === 'project') return { ...current, project: 'all' }
      if (key === 'branch') return { ...current, branch: 'all' }
      if (key === 'pattern') return { ...current, pattern: '' }
      return { ...current, confidence: 0 }
    })
  }

  const act = async (index: number, action: 'approve' | 'reject'): Promise<void> => {
    setBusy(index)
    setError(null)
    try {
      await api(`/api/suggestions/${action}`, {
        method: 'POST',
        body: JSON.stringify({ indices: [index] }),
      })
      load()
      onChanged?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(null)
    }
  }

  const openEdit = (proposal: PendingRecord): void => {
    setEditor({ kind: 'pending', index: proposal.index })
    setDraft(toDraft(proposal.episode))
    setError(null)
  }

  const openRevise = (flow: FlowRecord): void => {
    if (flow.id === null) return
    setEditor({ kind: 'flow', id: flow.id })
    setDraft(toDraft(flow.fields))
    setError(null)
  }

  const updateDraft = (key: keyof Draft, value: string): void => {
    setDraft((current) => (current === null ? current : { ...current, [key]: value }))
  }

  const saveDraft = async (): Promise<void> => {
    if (editor === null || draft === null) return
    setSaving(true)
    setError(null)
    try {
      const episode = fromDraft(draft)
      if (editor.kind === 'pending') {
        await api('/api/suggestions/update', {
          method: 'POST',
          body: JSON.stringify({ index: editor.index, episode }),
        })
      } else {
        await api('/api/flows/revise', {
          method: 'POST',
          body: JSON.stringify({ sessionId, id: editor.id, episode }),
        })
      }
      setEditor(null)
      setDraft(null)
      load()
      onChanged?.()
    } catch (caught) {
      setError(t('flows.edit.failed', { detail: caught instanceof Error ? caught.message : String(caught) }))
    } finally {
      setSaving(false)
    }
  }

  const archiveSelected = async (): Promise<void> => {
    if (selectedFlow === null || selectedFlow.id === null) return
    if (!window.confirm(t('flows.archive.confirm'))) return
    setError(null)
    try {
      await api('/api/flows/archive', {
        method: 'POST',
        body: JSON.stringify({ sessionId, id: selectedFlow.id }),
      })
      load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const sectionText = (title: string, value: string | undefined): JSX.Element | null => value === undefined || value.trim() === ''
    ? null
    : (
      <section className="flows-section">
        <h4>{title}</h4>
        <p>{value}</p>
      </section>
    )

  const sectionList = (title: string, values: string[] | undefined): JSX.Element | null => values === undefined || values.length === 0
    ? null
    : (
      <section className="flows-section">
        <h4>{title}</h4>
        <ul className="flows-bullets">
          {values.map((value, index) => <li key={`${title}-${index}`}>{value}</li>)}
        </ul>
      </section>
    )

  const index = data?.index

  return (
    <div className="flows-panel">
      <div className="flows-pending-bar">
        <button
          type="button"
          className="flows-pending-toggle"
          aria-expanded={pendingOpen}
          onClick={() => setPendingOpen((open) => !open)}
        >
          <span>{t('flows.pending', { count: pending.length })}</span>
          <span aria-hidden="true">{pendingOpen ? '▴' : '▾'}</span>
        </button>
        {pendingOpen && (
          pending.length === 0
            ? <p className="flows-muted">{t('flows.pending.empty')}</p>
            : (
              <ul className="flows-pending-list">
                {pending.map((proposal) => {
                  const fields = proposal.episode ?? {}
                  const label = String(fields.Pattern ?? fields.Goal ?? proposal.content ?? '')
                  return (
                    <li className="flows-pending-item" key={proposal.index}>
                      <div className="flows-pending-main">
                        <span className="flows-list-title">{label}</span>
                        {proposal.reason && <span className="flows-list-meta">{t('flows.pending.reason')}: {proposal.reason}</span>}
                        {typeof proposal.hits === 'number' && proposal.hits > 1 && (
                          <span className="flows-list-meta">{t('flows.pending.hits', { count: proposal.hits })}</span>
                        )}
                      </div>
                      <div className="flows-pending-actions">
                        <button type="button" className="flows-edit" disabled={busy !== null} onClick={() => openEdit(proposal)}>
                          {t('flows.edit')}
                        </button>
                        <button
                          type="button"
                          className="flows-approve"
                          disabled={busy !== null}
                          onClick={() => void act(proposal.index, 'approve')}
                        >
                          {t('flows.pending.approve')}
                        </button>
                        <button
                          type="button"
                          className="flows-reject"
                          disabled={busy !== null}
                          onClick={() => void act(proposal.index, 'reject')}
                        >
                          {t('flows.pending.reject')}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )
        )}
      </div>

      {editor !== null && draft !== null && (
        <div className="flows-editor">
          <h3>{editor.kind === 'pending' ? t('flows.edit.title') : t('flows.revise.title')}</h3>
          <div className="flows-editor-grid">
            {(['Pattern', 'Goal', 'Confidence'] as const).map((key) => (
              <label className="flows-field" key={key}>
                <span>{draftLabel(key, t)}</span>
                <input value={draft[key]} onChange={(event) => updateDraft(key, event.target.value)} />
              </label>
            ))}
            {(['Approach', 'Worked', 'Failed', 'Correction', 'Reuse when', 'Refs'] as const).map((key) => (
              <label className="flows-field flows-field-wide" key={key}>
                <span>{draftLabel(key, t)}</span>
                <textarea rows={2} value={draft[key]} onChange={(event) => updateDraft(key, event.target.value)} />
              </label>
            ))}
          </div>
          <div className="flows-editor-actions">
            <button type="button" className="flows-approve" disabled={saving} onClick={() => void saveDraft()}>
              {t('flows.save')}
            </button>
            <button type="button" className="flows-reject" disabled={saving} onClick={() => { setEditor(null); setDraft(null) }}>
              {t('flows.cancel')}
            </button>
          </div>
        </div>
      )}

      {error !== null && (
        <div className="flows-error">
          <span>{t('flows.error')} {error}</span>
          <button type="button" className="flows-retry" onClick={load}>{t('flows.retry')}</button>
        </div>
      )}
      {data?.partial === true && <p className="flows-partial">{t('flows.partial')}</p>}

      {loading && data === null
        ? <p className="flows-muted">{t('flows.loading')}</p>
        : (
          <>
            <div className="flows-toolbar">
              <label className="flows-field">
                <span>{t('flows.filter.project')}</span>
                <select
                  value={filters.project}
                  onChange={(event) => setFilters((current) => ({ ...current, project: event.target.value as Filters['project'] }))}
                >
                  <option value="all">{t('flows.filter.all')}</option>
                  <option value="project">{t('flows.filter.projectOnly')}</option>
                  <option value="global">{t('flows.filter.global')}</option>
                </select>
              </label>
              <label className="flows-field">
                <span>{t('flows.filter.branch')}</span>
                <select
                  value={filters.branch}
                  onChange={(event) => setFilters((current) => ({ ...current, branch: event.target.value }))}
                >
                  <option value="all">{t('flows.filter.all')}</option>
                  {branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                </select>
              </label>
              <label className="flows-field">
                <span>{t('flows.filter.pattern')}</span>
                <input
                  type="search"
                  value={filters.pattern}
                  onChange={(event) => setFilters((current) => ({ ...current, pattern: event.target.value }))}
                />
              </label>
              <label className="flows-field">
                <span>{t('flows.filter.confidence')}</span>
                <select
                  value={String(filters.confidence)}
                  onChange={(event) => setFilters((current) => ({ ...current, confidence: Number(event.target.value) }))}
                >
                  <option value="0">{t('flows.filter.all')}</option>
                  <option value="0.5">≥ 0.50</option>
                  <option value="0.8">≥ 0.80</option>
                </select>
              </label>
            </div>

            {activeFilters.length > 0 && (
              <div className="flows-chips">
                {activeFilters.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className="flows-chip"
                    aria-label={`${chip.label} ×`}
                    onClick={() => clearFilter(chip.key)}
                  >
                    {chip.label} <span aria-hidden="true">×</span>
                  </button>
                ))}
                <button type="button" className="flows-clear" onClick={() => setFilters(EMPTY_FILTERS)}>
                  {t('flows.filter.clear')}
                </button>
              </div>
            )}

            <div className="flows-body">
              <div className="flows-list" role="list">
                <div className="flows-list-count">{t('flows.list.count', { count: filtered.length })}</div>
                {flows.length === 0
                  ? <p className="flows-muted">{t('flows.empty')}</p>
                  : filtered.length === 0
                    ? <p className="flows-muted">{t('flows.emptyFiltered')}</p>
                    : filtered.map((flow) => (
                      <FlowRow
                        key={flow.id ?? `${flow.kind}-${flow.summary ?? ''}-${flow.date ?? ''}`}
                        flow={flow}
                        active={flow.id !== null && flow.id === selected}
                        t={t}
                        onSelect={() => setSelected(flow.id)}
                      />
                    ))}
              </div>

              <div className="flows-detail">
                {selectedFlow === null
                  ? <p className="flows-muted">{t('flows.detail.empty')}</p>
                  : (
                    <>
                      <h3 className="flows-detail-title">{String(selectedFlow.fields.Pattern ?? selectedFlow.summary ?? selectedFlow.id ?? '')}</h3>
                      <div className="flows-detail-meta">
                        <span className="flows-badge">{selectedFlow.kind === 'pattern' ? t('flows.kind.pattern') : t('flows.kind.episode')}</span>
                        <span>{selectedFlow.project ? t('flows.filter.projectOnly') : t('flows.filter.global')}</span>
                        {selectedFlow.branch && <span>{selectedFlow.branch}</span>}
                        <span>{t('flows.confidence', { value: confidenceOf(selectedFlow).toFixed(2) })}</span>
                      </div>
                      <div className="flows-detail-actions">
                        <button type="button" className="flows-edit" onClick={() => openRevise(selectedFlow)}>{t('flows.revise')}</button>
                        <button type="button" className="flows-reject" onClick={() => void archiveSelected()}>{t('flows.archive')}</button>
                      </div>
                      {sectionText(t('flows.goal'), selectedFlow.fields.Goal)}
                      {sectionList(t('flows.approach'), selectedFlow.fields.Approach)}
                      {sectionList(t('flows.worked'), selectedFlow.fields.Worked)}
                      {sectionList(t('flows.failed'), selectedFlow.fields.Failed)}
                      {sectionText(t('flows.correction'), selectedFlow.fields.Correction)}
                      {sectionText(t('flows.reuse'), selectedFlow.fields['Reuse when'])}
                      {sectionList(t('flows.refs'), selectedFlow.fields.Refs)}

                      <section className="flows-section">
                        <h4>{t('flows.history')}</h4>
                        {selectedFlow.fields.Supersedes !== undefined || (selectedFlow.fields['Merged-from']?.length ?? 0) > 0
                          ? (
                            <ul className="flows-bullets">
                              {selectedFlow.fields.Supersedes !== undefined && <li>Supersedes: {selectedFlow.fields.Supersedes}</li>}
                              {(selectedFlow.fields['Merged-from'] ?? []).map((id) => <li key={`merged-${id}`}>Merged from: {id}</li>)}
                            </ul>
                          )
                          : <p className="flows-muted">{t('flows.history.empty')}</p>}
                      </section>

                      <section className="flows-section">
                        <h4>{t('flows.why')}</h4>
                        <p className="flows-muted">{t('flows.why.empty')}</p>
                      </section>
                    </>
                  )}
              </div>
            </div>

            <div className="flows-index">
              <div className="flows-index-line">
                <span className="flows-tier">{index === undefined ? t('flows.index.none') : t('flows.index.tier', { tier: index.tier })}</span>
                {index !== undefined && !index.enabled && <span className="flows-muted">{t('flows.index.disabled')}</span>}
              </div>
              <details>
                <summary>{t('flows.index.title')}</summary>
                {index !== undefined && (
                  <div className="flows-index-detail">
                    <span>{t('flows.index.database', { value: index.database ?? t('flows.index.none') })}</span>
                    <span>{t('flows.index.embedding', { value: index.embedding ?? t('flows.index.none') })}</span>
                    <span>{t('flows.index.rerank', { value: index.rerank ?? t('flows.index.none') })}</span>
                    <span>{t('flows.index.lastRebuild', { value: index.lastRebuild ?? t('flows.index.none') })}</span>
                    <span>{t('flows.index.drift', { value: String(index.drift) })}</span>
                  </div>
                )}
              </details>
            </div>
          </>
        )}
    </div>
  )
}
