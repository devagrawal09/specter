import { expect, it } from 'vitest'

import { createSpecterProtocolHttpClient } from './http-client'

const goRuntimeUrl = process.env.SPECTER_GO_PROTOCOL_URL

it.runIf(Boolean(goRuntimeUrl))(
  'uses the TypeScript client against the Go runtime',
  async () => {
    const client = createSpecterProtocolHttpClient(goRuntimeUrl ?? '')
    await expect(
      client.capabilities(['commands', 'queries']),
    ).resolves.toMatchObject({
      runtime: { language: 'go' },
      negotiated: ['commands', 'queries'],
    })

    const todoId = `typescript-client-${Date.now()}`
    await expect(
      client.command({
        operationId: `command-${todoId}`,
        idempotencyKey: todoId,
        command: {
          type: 'addTodo',
          payload: { todoId, title: 'Across runtimes' },
        },
      }),
    ).resolves.toMatchObject({ status: 'committed' })
    await expect(
      client.query({
        operationId: `query-${todoId}`,
        query: { type: 'todosQuery', payload: {} },
      }),
    ).resolves.toMatchObject({ result: [{ todoId, title: 'Across runtimes' }] })
  },
)
