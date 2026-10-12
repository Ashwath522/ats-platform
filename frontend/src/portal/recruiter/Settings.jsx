import React from 'react'
import { PageHeader, Card, EmptyState } from '../../ui/index.jsx'

/** Settings — implementation pending (see docs/ui-reference/assets/images/22-recruiter-settings.png). */
export default function Page() {
  return (
    <>
      <PageHeader title="Settings" />
      <Card><EmptyState title="Coming up" text="This page is being built." /></Card>
    </>
  )
}
