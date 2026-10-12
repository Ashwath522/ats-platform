import React from 'react'
import { PageHeader, Card, EmptyState } from '../../ui/index.jsx'

/** Analytics — implementation pending (see docs/ui-reference/assets/images/21-recruiter-analytics.png). */
export default function Page() {
  return (
    <>
      <PageHeader title="Analytics" />
      <Card><EmptyState title="Coming up" text="This page is being built." /></Card>
    </>
  )
}
