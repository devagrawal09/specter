import { createSpecterApp } from '@specter-ts/core'

import { runWithSpecterCodeReferenceDb } from '../../db/client.server'
import { specterCodeReferenceSpecterAppConfig } from './registry'

const app = await createSpecterApp(specterCodeReferenceSpecterAppConfig)

const defaultWorkspace = {
  workspaceId: 'workspace-main',
  name: 'Main Workspace',
}

async function ensureDefaultWorkspace() {
  const workspaces = await app.workspacesQuery({})

  if (
    !workspaces.some((workspace) => workspace.id === defaultWorkspace.workspaceId)
  ) {
    await app.createWorkspace(defaultWorkspace)
  }
}

export async function postChatMessageOnServer(data: {
  workspaceId: string
  authorName: string
  content: string
}) {
  await runWithSpecterCodeReferenceDb(() =>
    app.postMessage({ ...data, messageId: crypto.randomUUID() }),
  )
}

export async function listWorkspaceMessagesOnServer(data: { workspaceId: string }) {
  return runWithSpecterCodeReferenceDb(() => app.chatMessagesQuery(data))
}

export async function createWorkspaceOnServer(data: { name: string }) {
  return runWithSpecterCodeReferenceDb(async () => {
    await ensureDefaultWorkspace()
    await app.createWorkspace({ ...data, workspaceId: crypto.randomUUID() })
    return app.workspacesQuery({})
  })
}

export async function listWorkspacesOnServer() {
  return runWithSpecterCodeReferenceDb(async () => {
    await ensureDefaultWorkspace()
    return app.workspacesQuery({})
  })
}
