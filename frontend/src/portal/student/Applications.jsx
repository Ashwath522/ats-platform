import React from 'react'
import { PageHeader, Card, EmptyState } from '../../ui/index.jsx'

/** My Applications — implementation pending (see docs/ui-reference/assets/images/09-my-applications.png). */
export default function Page() {
  return (
    <>
      <PageHeader title="My Applications" />
      <Card><EmptyState title="Coming up" text="This page is being built." /></Card>
    </>
  )
}
