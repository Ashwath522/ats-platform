import React from 'react'
import { PageHeader, Card, EmptyState } from '../../ui/index.jsx'

/** Student Dashboard — implementation pending (see docs/ui-reference/assets/images/04-student-dashboard.png). */
export default function Page() {
  return (
    <>
      <PageHeader title="Student Dashboard" />
      <Card><EmptyState title="Coming up" text="This page is being built." /></Card>
    </>
  )
}
