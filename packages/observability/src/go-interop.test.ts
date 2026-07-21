import { execFile, execFileSync } from 'node:child_process'
import { createServer, type IncomingMessage } from 'node:http'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import {
  createMemoryEventLog,
  createMemorySliceStore,
} from '@specter-ts/memory'

import { copyCollectorState, createCollectorState } from './collector-model'
import { createSpecterObservabilityCollector } from './collector'
import { createSpecterObservabilityHttpHandler } from './http-handler'
import { createRuntimeObservationProducer } from './producer'

const run = promisify(execFile)
const hasGo = (() => {
  try {
    execFileSync('go', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

it.skipIf(!hasGo)(
  'ingests real Go and TypeScript producers into one collector',
  async () => {
    const collector = await createSpecterObservabilityCollector({
      eventLog: createMemoryEventLog(),
      store: createMemorySliceStore(createCollectorState, {
        clone: copyCollectorState,
      }),
    })
    const handler = createSpecterObservabilityHttpHandler({ collector })
    const server = createServer(async (request, response) => {
      try {
        const webResponse = await handler(await toWebRequest(request))
        response.writeHead(
          webResponse.status,
          Object.fromEntries(webResponse.headers.entries()),
        )
        response.end(Buffer.from(await webResponse.arrayBuffer()))
      } catch (cause) {
        response.writeHead(500, { 'content-type': 'text/plain' })
        response.end(cause instanceof Error ? cause.message : String(cause))
      }
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Collector test server did not bind a TCP port.')
    const collectorUrl = `http://127.0.0.1:${address.port}`
    const typescriptSource = {
      application: 'typescript-interop',
      environment: 'test',
      runtimeLanguage: 'typescript',
      runtimeVersion: 'test',
      instanceId: 'typescript-interop-instance',
      eventLogId: 'typescript-interop-log',
    }
    const producer = createRuntimeObservationProducer({
      endpoint: collectorUrl,
      source: typescriptSource,
      retryDelayMs: 1,
    })

    try {
      producer.record({
        observationId: 'typescript-interop-observation',
        operationId: 'typescript-interop-operation',
        sequence: 1,
        observedAt: new Date().toISOString(),
        source: typescriptSource,
        kind: 'query.completed',
        queryType: 'todosQuery',
        outcome: 'succeeded',
      })
      await producer.flush()

      const goRuntime = fileURLToPath(
        new URL('../../../runtimes/go/', import.meta.url),
      )
      await run('go', ['run', './cmd/observation-fixture', collectorUrl], {
        cwd: goRuntime,
        timeout: 30_000,
      })

      const queriedOverview = await collector.overview()
      expect(
        queriedOverview.sources
          .map((item) => item.source.runtimeLanguage)
          .sort(),
      ).toEqual(['go', 'typescript'])

      const readResponse = await fetch(`${collectorUrl}/v1/overview`)
      expect(readResponse.status).toBe(200)
      expect(readResponse.headers.get('Specter-Protocol-Version')).toBeNull()
      const readOverview = (await readResponse.json()) as {
        readonly observationCount: number
        readonly sources: readonly {
          readonly source: { readonly runtimeLanguage: string }
        }[]
      }
      expect(readOverview.observationCount).toBe(2)
      expect(
        readOverview.sources.map((item) => item.source.runtimeLanguage).sort(),
      ).toEqual(['go', 'typescript'])
    } finally {
      await producer.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
  40_000,
)

async function toWebRequest(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else if (value !== undefined) {
      headers.set(name, value)
    }
  }
  return new Request(`http://127.0.0.1${request.url ?? '/'}`, {
    method: request.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  })
}
