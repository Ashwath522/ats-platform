import React from 'react'
import { PageHeader, Card, EmptyState } from '../../ui/index.jsx'

/** Interviews — implementation pending (see docs/ui-reference/assets/images/18-interview-management.png). */
export default function Page() {
  return (
    <>
      <PageHeader title="Interviews" />
      <Card><EmptyState title="Coming up" text="This page is being built." /></Card>
    </>
  )
}
