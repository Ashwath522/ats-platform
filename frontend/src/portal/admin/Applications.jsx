import React from 'react'
import { PageHeader, Card, EmptyState } from '../../ui/index.jsx'

/** Applications — implementation pending (see docs/ui-reference/assets/images/23-admin-dashboard.png). */
export default function Page() {
  return (
    <>
      <PageHeader title="Applications" />
      <Card><EmptyState title="Coming up" text="This page is being built." /></Card>
    </>
  )
}
