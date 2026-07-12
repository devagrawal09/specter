export type SpecterCodeStreamEvent = {
  id: string
  order: number
  type: string
  payload: unknown
  recordedAt: string | Date
}

export type LoadSpecterCodeEventsInput = {
  afterOrder?: number
}

export type SpecterCodeEventStreamOptions = {
  loadEvents: (input: LoadSpecterCodeEventsInput) => Promise<readonly SpecterCodeStreamEvent[]>
}

export type OpenSpecterCodeEventStreamInput = {
  afterOrder?: number
  live?: boolean
  signal?: AbortSignal
}

const textEncoder = new TextEncoder()

export function createSpecterCodeEventStream(options: SpecterCodeEventStreamOptions) {
  const subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>()

  return {
    async open(input: OpenSpecterCodeEventStreamInput = {}) {
      const live = input.live ?? true
      let closeSubscriber: (() => void) | undefined

      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          closeSubscriber = () => {
            subscribers.delete(controller)
            try {
              controller.close()
            } catch {
              // The stream may already be closed by the consumer.
            }
          }

          if (live) subscribers.add(controller)

          try {
            const events = await options.loadEvents({ afterOrder: input.afterOrder })
            for (const event of events) {
              controller.enqueue(encodeServerSentEvent(event))
            }
            if (!live) controller.close()
          } catch (error) {
            controller.error(error)
          }
        },
        cancel() {
          if (closeSubscriber) closeSubscriber()
        },
      })

      if (input.signal) {
        if (input.signal.aborted) closeSubscriber?.()
        else input.signal.addEventListener('abort', () => closeSubscriber?.(), { once: true })
      }

      return new Response(body, {
        headers: {
          'cache-control': 'no-cache, no-transform',
          'content-type': 'text/event-stream; charset=utf-8',
          'x-accel-buffering': 'no',
        },
      })
    },
    publish(event: SpecterCodeStreamEvent) {
      const encoded = encodeServerSentEvent(event)
      for (const subscriber of subscribers) {
        subscriber.enqueue(encoded)
      }
    },
  }
}

export function formatServerSentEvent(event: SpecterCodeStreamEvent) {
  const normalized = normalizeStreamEvent(event)
  return [
    `id: ${normalized.order}`,
    `event: ${normalized.type}`,
    `data: ${JSON.stringify(normalized)}`,
    '',
    '',
  ].join('\n')
}

function encodeServerSentEvent(event: SpecterCodeStreamEvent) {
  return textEncoder.encode(formatServerSentEvent(event))
}

function normalizeStreamEvent(event: SpecterCodeStreamEvent) {
  return {
    ...event,
    recordedAt:
      event.recordedAt instanceof Date ? event.recordedAt.toISOString() : event.recordedAt,
  }
}
