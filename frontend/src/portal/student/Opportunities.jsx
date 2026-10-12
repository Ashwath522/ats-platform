import React from 'react'
import { PageHeader, Card, EmptyState } from '../../ui/index.jsx'

/** Opportunities — implementation pending (see docs/ui-reference/assets/images/08-opportunities.png). */
export default function Page() {
  return (
    <>
      <PageHeader title="Opportunities" />
      <Card><EmptyState title="Coming up" text="This page is being built." /></Card>
    </>
  )
}
