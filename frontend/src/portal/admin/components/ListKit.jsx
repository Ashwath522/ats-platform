/**
 * Building blocks shared by the supporting admin list pages (Companies, Job
 * Postings, Applications, Interviews, Offers, Audit Logs): a filter toolbar,
 * server-side pagination state and CSV export through the admin API.
 */
import React, { useEffect, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { Button, Input, downloadCsv, useToast } from '../../../ui/index.jsx'
import { toRows, useDebounced } from './adminKit.jsx'

/** Search box + filter selects in one wrapping row. */
export function ListToolbar({ q, setQ, placeholder = 'Search…', children }) {
  return (
    <div className="adm-filterbar adm-list-toolbar">
      <div className="adm-list-search">
        <Input icon={Search} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      </div>
      {children}
    </div>
  )
}

/**
 * Search text (debounced) + page / page size that reset to page 1 whenever a
 * filter changes. `filters` is any serialisable value.
 */
export function useListState(filters, initialQ = '') {
  const [q, setQ] = useState(initialQ)
  const dq = useDebounced(q, 300)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const key = JSON.stringify(filters)
  useEffect(() => { setPage(1) }, [key, dq, pageSize])
  return { q, setQ, dq: dq.trim(), page, setPage, pageSize, setPageSize }
}

/** "Export CSV" button: fetches `url` (an export=true endpoint), maps rows with `columns` ([header, key|fn]). */
export function ExportButton({ api, url, filename, columns, pick = (d) => d.items, label = 'Export CSV', variant = 'secondary' }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const data = await api.get(url)
      const items = pick(data) || []
      if (!items.length) { toast('Nothing to export for the current filters', 'info'); return }
      downloadCsv(filename, toRows(items, columns), columns.map((c) => c[0]))
      toast(`Exported ${items.length} row${items.length === 1 ? '' : 's'}`, 'success')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return <Button variant={variant} icon={Download} loading={busy} onClick={run}>{label}</Button>
}

/** Two-line cell: bold primary + muted secondary. */
export function Cell2({ main, sub, title }) {
  return (
    <span className="adm-c2" title={title}>
      <strong>{main || '—'}</strong>
      {sub && <small>{sub}</small>}
    </span>
  )
}

export const money = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })} LPA`)
