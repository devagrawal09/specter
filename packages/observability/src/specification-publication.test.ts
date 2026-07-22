import {
  createCommandSlice,
  digestSpecification,
  event,
} from '@specter-ts/spec'
import {
  createMemoryEventLog,
  createMemorySliceStoreService,
} from '@specter-ts/memory'
import type { SpecificationPublication } from '@specter-ts/protocol'
import { describe, expect, it } from 'vitest'

import { copyCollectorState, createCollectorState } from './collector-model'
import { createSpecterObservabilityCollector } from './collector'
import { createSpecterObservabilityHttpHandler } from './http-handler'
import { createRuntimeObservationProducer } from './producer'

const source = {
  application: 'todo-reference',
  environment: 'test',
  runtimeLanguage: 'typescript',
  runtimeVersion: '0.3.0',
  instanceId: 'instance-1',
  eventLogId: 'todo-log',
} as const
const document = createCommandSlice('addTodo')
  .description('Adds a todo.')
  .scenarios({
    description: 'Adds one.',
    given: [],
    when: { id: '1' },
    expect: [event('todo-added', { id: '1' })],
  })
const publication: SpecificationPublication = {
  protocolVersion: 1,
  kind: 'specifications.publish',
  requestId: 'publication-1',
  source,
  specifications: [{ digest: digestSpecification(document), document }],
}

async function handler() {
  const collector = await createSpecterObservabilityCollector({
    eventLog: createMemoryEventLog(),
    store: createMemorySliceStoreService(createCollectorState, {
      clone: copyCollectorState,
    }),
  })
  return createSpecterObservabilityHttpHandler({ collector })
}

describe('specification publication vertical path', () => {
  it('publishes, reads, deduplicates, and explicitly prunes specifications', async () => {
    const handle = await handler()
    const publish = () =>
      handle(
        new Request('http://collector/specter/v1/specifications', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(publication),
        }),
      )
    expect((await publish()).status).toBe(202)
    expect((await publish()).status).toBe(202)
    const listed = (await (
      await handle(new Request('http://collector/v1/specifications'))
    ).json()) as { digest: string; sources: unknown[] }[]
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ digest: digestSpecification(document) })
    expect(listed[0]?.sources).toHaveLength(1)
    const removed = await (
      await handle(
        new Request('http://collector/v1/specifications', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ digests: [digestSpecification(document)] }),
        }),
      )
    ).json()
    expect(removed).toEqual({ removed: 1 })
  })

  it('returns protocol 400 responses for invalid documents and digests', async () => {
    const handle = await handler()
    const invalidDocument = structuredClone(publication) as unknown as {
      specifications: Array<{
        digest: string
        document: Record<string, unknown>
      }>
    }
    const firstDocument = invalidDocument.specifications[0]
    if (!firstDocument) throw new Error('Expected publication fixture.')
    firstDocument.document.implementation = 'typescript'
    const invalidDigest = structuredClone(publication) as unknown as {
      specifications: Array<{ digest: string }>
    }
    const firstDigest = invalidDigest.specifications[0]
    if (!firstDigest) throw new Error('Expected publication fixture.')
    firstDigest.digest = `sha256:${'0'.repeat(64)}`

    for (const body of [invalidDocument, invalidDigest]) {
      const response = await handle(
        new Request('http://collector/specter/v1/specifications', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: { code: 'SPECTER_INVALID_MESSAGE' },
      })
    }
  })

  it('chunks startup publication and retries a missing acknowledgement with backoff', async () => {
    const documents = Array.from({ length: 101 }, (_, index) =>
      createCommandSlice(`slice${index}`)
        .description(`Slice ${index}.`)
        .scenarios({
          description: 'Runs.',
          given: [],
          when: { index },
          expect: [event('slice-ran', { index })],
        }),
    )
    const sizes: number[] = []
    let first = true
    let secondRequestAt = 0
    const startedAt = Date.now()
    const producer = createRuntimeObservationProducer({
      collectorUrl: 'http://collector',
      source,
      specifications: documents,
      retryDelayMs: 20,
      maxRetryDelayMs: 20,
      retryWindowMs: 1_000,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as SpecificationPublication
        sizes.push(body.specifications.length)
        if (sizes.length === 2) secondRequestAt = Date.now()
        const acceptedDigests = first
          ? []
          : body.specifications.map((item) => item.digest)
        first = false
        return Response.json({
          protocolVersion: 1,
          kind: 'specifications.ack',
          requestId: body.requestId,
          acceptedDigests,
        })
      },
    })
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('publication did not finish')),
        1_000,
      )
      const poll = setInterval(() => {
        if (sizes.length >= 3) {
          clearInterval(poll)
          clearTimeout(timeout)
          resolve()
        }
      }, 5)
    })
    await producer.close()
    expect(sizes).toEqual([100, 100, 1])
    expect(secondRequestAt - startedAt).toBeGreaterThanOrEqual(15)
  })
})
