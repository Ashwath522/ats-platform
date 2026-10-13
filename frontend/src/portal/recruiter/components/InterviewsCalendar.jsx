/** Month / Week / Day calendar + selected-day agenda for the Interviews page. */
import React, { useMemo } from 'react'
import { CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Eye, Video, XCircle } from 'lucide-react'
import { Avatar, Badge, Button, EmptyState, IconButton, Menu, Segmented } from '../../../ui/index.jsx'
import { ModeBadge, dayKey, fmtD, fmtRange, fmtT, roundColor, todayKey } from './HiringCommon.jsx'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const keyToDate = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

export function interviewActions(iv, act) {
  if (iv.kind === 'ai') return [{ label: 'View AI result', icon: Eye, onClick: () => act('details', iv) }]
  return [
    { label: 'View details', icon: Eye, onClick: () => act('details', iv) },
    iv.status !== 'completed' && { label: iv.status === 'cancelled' ? 'Re-schedule' : 'Reschedule', icon: CalendarClock, onClick: () => act('reschedule', iv) },
    iv.status === 'scheduled' && { label: 'Mark completed', icon: CheckCircle2, onClick: () => act('complete', iv) },
    iv.status !== 'cancelled' && { label: iv.has_feedback ? 'Edit feedback' : 'Add feedback', icon: CheckCircle2, onClick: () => act('feedback', iv) },
    iv.status === 'scheduled' && { label: 'Cancel interview', icon: XCircle, danger: true, onClick: () => act('cancel', iv) },
  ]
}

export function JoinOrView({ iv, act, size = 'sm', compact }) {
  const ended = new Date(iv.ends_at || iv.starts_at).getTime() < Date.now()
  if (iv.kind === 'human' && iv.status === 'scheduled' && iv.mode === 'online' && iv.meeting_link && !ended) {
    return <Button size={size} variant="outline" icon={Video} href={iv.meeting_link} aria-label={`Join interview with ${iv.candidate_name}`}>Join</Button>
  }
  return <Button size={size} variant="outline" onClick={() => act('details', iv)}>{iv.kind === 'ai' || compact ? 'View' : 'View Details'}</Button>
}

export default function InterviewsCalendar({ items, rounds, view, setView, selDay, setSelDay, cursor, setCursor, act }) {
  const byDay = useMemo(() => {
    const m = {}
    for (const iv of items) {
      if (iv.status === 'cancelled') continue
      const k = dayKey(iv.starts_at)
      ;(m[k] = m[k] || []).push(iv)
    }
    Object.values(m).forEach((l) => l.sort((a, b) => a.starts_at.localeCompare(b.starts_at)))
    return m
  }, [items])
  const today = todayKey()
  const sel = keyToDate(selDay)

  function move(dir) {
    if (view === 'month') setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1))
    else {
      const d = addDays(sel, dir * (view === 'week' ? 7 : 1))
      setSelDay(dayKey(d)); setCursor(new Date(d.getFullYear(), d.getMonth(), 1))
    }
  }
  const title = view === 'month'
    ? cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : view === 'week'
      ? `${fmtD(addDays(sel, -sel.getDay()), { day: '2-digit', month: 'short' })} – ${fmtD(addDays(sel, 6 - sel.getDay()), { day: '2-digit', month: 'short', year: 'numeric' })}`
      : fmtD(sel, { weekday: 'long', day: '2-digit', month: 'short' })

  const pick = (d) => { setSelDay(dayKey(d)); if (d.getMonth() !== cursor.getMonth()) setCursor(new Date(d.getFullYear(), d.getMonth(), 1)) }
  const dayItems = byDay[selDay] || []
  const legend = [...new Set(items.filter((i) => i.status !== 'cancelled').map((i) => i.round_name))]

  let body
  if (view === 'month') {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const start = addDays(first, -first.getDay())
    const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i))
    const weeks = cells[35].getMonth() !== cursor.getMonth() ? cells.slice(0, 35) : cells
    body = (
      <div className="hr-cal-grid" role="grid" aria-label={title}>
        {DOW.map((d) => <div key={d} className="hr-cal-dow" role="columnheader">{d}</div>)}
        {weeks.map((d) => {
          const k = dayKey(d)
          const ev = byDay[k] || []
          return (
            <button key={k} type="button" role="gridcell" aria-selected={k === selDay}
              aria-label={`${fmtD(d, { weekday: 'long', day: 'numeric', month: 'long' })}: ${ev.length} interview${ev.length === 1 ? '' : 's'}`}
              className={`hr-cal-day ${d.getMonth() !== cursor.getMonth() ? 'out' : ''} ${k === today ? 'today' : ''} ${k === selDay ? 'sel' : ''}`}
              onClick={() => pick(d)}>
              <span className="n">{d.getDate()}</span>
              <span className="hr-cal-dots">{ev.slice(0, 4).map((iv) => <i key={iv.id} style={{ background: roundColor(iv.round_name, rounds) }} />)}</span>
            </button>
          )
        })}
      </div>
    )
  } else if (view === 'week') {
    const ws = addDays(sel, -sel.getDay())
    body = (
      <div className="hr-week">
        {Array.from({ length: 7 }, (_, i) => addDays(ws, i)).map((d) => {
          const k = dayKey(d)
          return (
            <div key={k} className={`hr-week-col ${k === selDay ? 'sel' : ''}`}>
              <button type="button" className="h" onClick={() => setSelDay(k)} aria-label={fmtD(d, { weekday: 'long', day: 'numeric', month: 'long' })}>
                {DOW[d.getDay()]}<b style={k === today ? { color: 'var(--cl-blue)' } : undefined}>{d.getDate()}</b>
              </button>
              {(byDay[k] || []).map((iv) => (
                <button key={iv.id} type="button" className="hr-week-ev" style={{ borderLeftColor: roundColor(iv.round_name, rounds) }} onClick={() => act('details', iv)}>
                  <strong>{iv.kind === 'ai' ? 'AI' : fmtT(iv.starts_at)}</strong>{iv.candidate_name}
                </button>
              ))}
            </div>
          )
        })}
      </div>
    )
  } else {
    const hours = Array.from({ length: 15 }, (_, i) => i + 7)
    const outside = dayItems.filter((iv) => { const h = new Date(iv.starts_at).getHours(); return h < 7 || h > 21 })
    body = (
      <div className="hr-dayview">
        {outside.length > 0 && <div className="hr-small" style={{ padding: '4px 0 8px' }}>{outside.length} interview{outside.length > 1 ? 's' : ''} outside 7 AM – 10 PM — see the agenda.</div>}
        {hours.map((h) => (
          <div className="hr-dayview-row" key={h}>
            <span>{new Date(2000, 0, 1, h).toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true }).toUpperCase()}</span>
            <div>
              {dayItems.filter((iv) => new Date(iv.starts_at).getHours() === h).map((iv) => (
                <button key={iv.id} type="button" className="hr-week-ev" style={{ borderLeftColor: roundColor(iv.round_name, rounds) }} onClick={() => act('details', iv)}>
                  <strong>{fmtRange(iv.starts_at, iv.ends_at)} · {iv.candidate_name}</strong>{iv.round_name} — {iv.job_title}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="hr-cal-wrap">
      <div className="hr-cal">
        <div className="hr-cal-head">
          <h3>{title}</h3>
          <IconButton icon={ChevronLeft} label={`Previous ${view}`} boxed onClick={() => move(-1)} />
          <IconButton icon={ChevronRight} label={`Next ${view}`} boxed onClick={() => move(1)} />
          <Segmented value={view} onChange={setView} options={[{ id: 'month', label: 'Month' }, { id: 'week', label: 'Week' }, { id: 'day', label: 'Day' }]} />
        </div>
        {body}
        {legend.length > 0 && (
          <div className="hr-cal-legend" aria-label="Round colours">
            {legend.map((r) => <span key={r}><i style={{ background: roundColor(r, rounds) }} />{r}</span>)}
            <Button size="sm" variant="ghost" onClick={() => { const d = new Date(); setSelDay(dayKey(d)); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)) }} style={{ marginLeft: 'auto', height: 26 }}>Today</Button>
          </div>
        )}
      </div>

      <div className="hr-agenda">
        <div className="hr-agenda-head">
          <h3>Interviews on {fmtD(sel, { day: 'numeric', month: 'short', year: 'numeric' })}</h3>
          <Badge tone="blue">{dayItems.length} Interview{dayItems.length === 1 ? '' : 's'}</Badge>
        </div>
        {dayItems.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No interviews this day" text="Pick a day with a coloured dot, or schedule a new interview." />
        ) : (
          <div className="hr-scroll">
            {dayItems.map((iv) => (
              <div className="hr-agenda-item" key={iv.id}>
                <div style={{ minWidth: 0 }}>
                  <div className="hr-agenda-time"><i style={{ background: roundColor(iv.round_name, rounds) }} />{iv.kind === 'ai' ? `Completed ${fmtT(iv.starts_at)}` : fmtRange(iv.starts_at, iv.ends_at)}</div>
                  <div className="hr-agenda-who">
                    <Avatar name={iv.candidate_name} src={iv.candidate_avatar} size={44} />
                    <div className="meta">
                      <strong>{iv.candidate_name}</strong>
                      <span className="cl-ellipsis" style={{ display: 'block' }}>{iv.job_title}</span>
                      <span>{iv.round_name}</span>
                    </div>
                  </div>
                </div>
                <div className="hr-agenda-act">
                  {iv.kind === 'ai' ? <span className="hr-score">AI {iv.eval_score ?? '—'}</span> : iv.status === 'scheduled' ? <ModeBadge mode={iv.mode} /> : <Badge tone={iv.status === 'completed' ? 'green' : 'red'} dot>{iv.pending_feedback ? 'Feedback due' : iv.status === 'completed' ? 'Completed' : 'No show'}</Badge>}
                  <div className="cl-row">
                    <JoinOrView iv={iv} act={act} />
                    <Menu items={interviewActions(iv, act)} label={`Actions for ${iv.candidate_name}`} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
