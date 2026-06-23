import { createSpecterApp } from '@specter-ts/core'
import { expect, test } from 'vitest'

import { sqliteScenario } from '../../db/scenario-tests'
import { chatSpecterAppConfig } from './registry'

test('posting a Specter mention records a simulated agent reply', async () => {
  await sqliteScenario(async () => {
    const app = createSpecterApp(chatSpecterAppConfig)

    await app.postMessage({
      workspaceId: 'workspace-1',
      authorName: 'Ada Lovelace',
      content: 'Can @specter help with this?',
    })

    const messages = await app.chatMessagesQuery({ workspaceId: 'workspace-1' })

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      workspaceId: 'workspace-1',
      author: { type: 'user', displayName: 'Ada Lovelace' },
      content: 'Can @specter help with this?',
    })
    expect(messages[1]).toMatchObject({
      workspaceId: 'workspace-1',
      author: { type: 'agent', displayName: 'Specter', agentId: 'specter' },
      content: 'Specter heard: Can @specter help with this?',
      parentMessageId: messages[0]?.id,
    })
  })
})
