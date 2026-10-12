import React from 'react'
import { PageHeader, Card, EmptyState } from '../../ui/index.jsx'

/** My Projects — implementation pending (see docs/ui-reference/assets/images/07-projects.png). */
export default function Page() {
  return (
    <>
      <PageHeader title="My Projects" />
      <Card><EmptyState title="Coming up" text="This page is being built." /></Card>
    </>
  )
}
