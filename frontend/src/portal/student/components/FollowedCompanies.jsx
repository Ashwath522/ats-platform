/** Dashboard section: companies the student follows + their newest roles. */
import React from 'react'
import { Link } from 'react-router-dom'
import { Building2, Briefcase, Sparkles } from 'lucide-react'
import { Alert, Button, Card, EmptyState, Skeleton, ViewAll, timeAgo } from '../../../ui/index.jsx'
import { useApi, useQuery } from '../../../ui/useApi.js'
import { CompanyLogo, DemoBadge } from '../../shared/companies.jsx'

export default function FollowedCompanies() {
  const api = useApi('candidate')
  const q = useQuery(() => api.get('/api/student/company-directory/following'), [api])
  const d = q.data
  return (
    <Card title="Followed Companies" action={<ViewAll to={d?.total ? '/candidate/companies?view=following' : '/candidate/companies'}>{d?.total ? 'View All' : 'Explore'}</ViewAll>}>
      {q.error ? <Alert tone="error">{q.error.message} <button className="cl-link" onClick={q.reload}>Retry</button></Alert>
        : q.loading && !d ? <div className="co-follow-row">{[0, 1, 2].map((i) => <Skeleton key={i} h={120} w={200} />)}</div>
          : !d?.items?.length ? (
            <EmptyState icon={Building2} title="Follow companies you’d love to work for"
              text="Get a notification as soon as they post a new job or internship."
              action={<Button size="sm" to="/candidate/companies">Explore companies</Button>} />
          ) : (
            <div className="cl-col" style={{ gap: 14 }}>
              <div className="co-follow-row" role="list">
                {d.items.map((c) => (
                  <Link key={c.slug} to={`/candidate/companies/${c.slug}`} className="co-follow-item" role="listitem">
                    <div className="cl-row" style={{ gap: 10, justifyContent: 'space-between' }}>
                      <CompanyLogo name={c.name} domain={c.domain} src={c.logo_url} size={40} />
                      {c.new_roles > 0 ? <span className="co-new">{c.new_roles} new</span> : c.is_demo ? <DemoBadge compact /> : null}
                    </div>
                    <strong className="cl-ellipsis">{c.name}</strong>
                    <small className="cl-muted cl-row" style={{ gap: 5 }}><Briefcase size={13} aria-hidden="true" />{c.open_roles ? `${c.open_roles} open role${c.open_roles === 1 ? '' : 's'}` : 'No open roles now'}</small>
                  </Link>
                ))}
              </div>
              {d.recent?.length > 0 && (
                <div className="cl-list">
                  {d.recent.slice(0, 3).map((n) => (
                    <Link key={n.link} to={n.link} className="cl-list-item" style={{ textDecoration: 'none', color: 'inherit' }}>
                      <span className="cl-ico"><Sparkles size={16} /></span>
                      <span className="cl-grow cl-ellipsis" style={{ fontSize: 13.5 }}>{n.title}</span>
                      <small className="cl-muted">{timeAgo(n.at)}</small>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
    </Card>
  )
}
