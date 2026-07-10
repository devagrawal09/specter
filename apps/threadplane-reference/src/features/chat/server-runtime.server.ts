import { createSpecterApp } from '@specter-ts/core'

import { runWithThreadplaneReferenceDb } from '../../db/client.server'
import { threadplaneReferenceSpecterAppConfig } from './registry'

const app = createSpecterApp(threadplaneReferenceSpecterAppConfig)

const defaultWorkspace = {
  workspaceId: 'workspace-main',
  name: 'Main Workspace',
}

async function ensureDefaultWorkspace() {
  const workspaces = await app.workspacesQuery({})

  if (
    !workspaces.some(
      (workspace) => workspace.id === defaultWorkspace.workspaceId,
    )
  ) {
    await app.createWorkspace(defaultWorkspace)
  }
}

export async function postChatMessageOnServer(data: {
  workspaceId: string
  authorName: string
  content: string
}) {
  await runWithThreadplaneReferenceDb(() => app.postMessage(data))
}

export async function listWorkspaceMessagesOnServer(data: {
  workspaceId: string
}) {
  return runWithThreadplaneReferenceDb(() => app.chatMessagesQuery(data))
}

export async function createWorkspaceOnServer(data: { name: string }) {
  return runWithThreadplaneReferenceDb(async () => {
    await ensureDefaultWorkspace()
    await app.createWorkspace(data)
    return app.workspacesQuery({})
  })
}

export async function listWorkspacesOnServer() {
  return runWithThreadplaneReferenceDb(async () => {
    await ensureDefaultWorkspace()
    return app.workspacesQuery({})
  })
}
