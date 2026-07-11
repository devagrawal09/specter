import { describe, expect, it } from 'vitest'

import { createSpecterCodeEventStream } from './adapters/event-stream'

describe('Specter Code event stream adapter', () => {
  it('replays persisted events after a cursor as OpenCode-style SSE frames', async () => {
    const stream = createSpecterCodeEventStream({
      async loadEvents({ afterOrder }) {
        return [
          {
            id: 'event-1',
            order: 1,
            type: 'user-message-submitted',
            payload: { content: 'ignored before cursor' },
            recordedAt: '2026-06-24T12:00:00.000Z',
          },
          {
            id: 'event-2',
            order: 2,
            type: 'agent-run-streamed',
            payload: { delta: 'hello' },
            recordedAt: '2026-06-24T12:00:01.000Z',
          },
        ].filter((event) => event.order > (afterOrder ?? 0))
      },
    })

    const response = await stream.open({ afterOrder: 1, live: false })

    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform')
    await expect(response.text()).resolves.toBe(
      'id: 2\n' +
        'event: agent-run-streamed\n' +
        'data: {"id":"event-2","order":2,"type":"agent-run-streamed","payload":{"delta":"hello"},"recordedAt":"2026-06-24T12:00:01.000Z"}\n\n',
    )
  })

  it('pushes newly published events to live subscribers', async () => {
    const stream = createSpecterCodeEventStream({ loadEvents: async () => [] })
    const abort = new AbortController()
    const response = await stream.open({ signal: abort.signal })
    const reader = response.body?.getReader()
    expect(reader).toBeDefined()

    stream.publish({
      id: 'event-live-1',
      order: 7,
      type: 'tool-call-completed',
      payload: { toolName: 'read' },
      recordedAt: '2026-06-24T12:00:07.000Z',
    })

    const chunk = await reader!.read()
    expect(new TextDecoder().decode(chunk.value)).toBe(
      'id: 7\n' +
        'event: tool-call-completed\n' +
        'data: {"id":"event-live-1","order":7,"type":"tool-call-completed","payload":{"toolName":"read"},"recordedAt":"2026-06-24T12:00:07.000Z"}\n\n',
    )

    abort.abort()
    reader!.releaseLock()
  })
})
