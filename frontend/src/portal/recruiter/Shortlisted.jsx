import React from 'react'
import { PageHeader, Card, EmptyState } from '../../ui/index.jsx'

/** Shortlisted Candidates — implementation pending (see docs/ui-reference/assets/images/17-shortlisted-candidates.png). */
export default function Page() {
  return (
    <>
      <PageHeader title="Shortlisted Candidates" />
      <Card><EmptyState title="Coming up" text="This page is being built." /></Card>
    </>
  )
}
