import { expect, test } from 'vitest'

import {
  sessionEventDefinitions,
  toOcppEventType,
  toSpecterEventType,
} from './events.ts'

test('every durable OC++ session event becomes a Specter event definition', async () => {
  expect(sessionEventDefinitions.length).toBeGreaterThan(0)
  const names = sessionEventDefinitions.map((definition) => definition.type)
  expect(new Set(names).size).toBe(names.length)
  expect(names).toContain('session-inbox-enqueued')
  expect(names.every((name) => !name.includes('.'))).toBe(true)
})

test('event type mapping round-trips', () => {
  expect(toSpecterEventType('session.inbox.enqueued')).toBe(
    'session-inbox-enqueued',
  )
  expect(toOcppEventType('session-inbox-enqueued')).toBe(
    'session.inbox.enqueued',
  )
})

test('payload decoding goes through the Standard Schema', async () => {
  const definition = sessionEventDefinitions.find(
    (d) => d.type === 'session-inbox-enqueued',
  )
  if (!definition) throw new Error('session-inbox-enqueued definition missing')
  await expect(definition.decode({})).rejects.toBeDefined()
})
