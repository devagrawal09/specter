import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { SpecterProtocolError, structuredProtocolError } from './errors'
import {
  assertRuntimeObservationBatch,
  parseProtocolJson,
  parseProtocolMessage,
  parseRuntimeObservation,
} from './validation'

const source = {
  application: 'todo',
  environment: 'test',
  runtimeLanguage: 'typescript',
  runtimeVersion: '0.3.0',
  instanceId: 'instance-1',
  eventLogId: 'log-1',
}

const fixtureRoot = new URL('../../../protocol/fixtures/', import.meta.url)

function observation(observationId = 'observation-1') {
  return {
    observationId,
    operationId: 'operation-1',
    sequence: 1,
    observedAt: '2026-01-02T03:04:05.000Z',
    source,
    kind: 'query.completed' as const,
  }
}

function batch(observations: readonly unknown[] = [observation()]) {
  return {
    protocolVersion: 1,
    kind: 'observations.batch',
    requestId: 'request-1',
    observations,
  }
}

describe('observation protocol validation', () => {
  it('does not treat inherited object keys as public error codes', () => {
    const cause = new Error('private credential') as Error & { code: string }
    cause.code = 'toString'

    expect(structuredProtocolError(cause)).toEqual({
      code: 'SPECTER_INTERNAL_ERROR',
      message: 'The Specter runtime could not complete the request.',
    })
  })

  it('redacts credential-bearing protocol errors with known and unknown codes', () => {
    const credential = 'postgres://admin:secret@database.internal/specter'
    const known = structuredProtocolError(
      new SpecterProtocolError({
        code: 'SPECTER_INVALID_MESSAGE',
        message: credential,
      }),
    )
    const unknown = structuredProtocolError(
      new SpecterProtocolError({
        code: 'DATABASE_CONNECTION_FAILED',
        message: credential,
      }),
    )

    expect(known).toEqual({
      code: 'SPECTER_INVALID_MESSAGE',
      message: 'Protocol message is invalid.',
    })
    expect(unknown).toEqual({
      code: 'SPECTER_INTERNAL_ERROR',
      message: 'The Specter runtime could not complete the request.',
    })
    expect(JSON.stringify({ known, unknown })).not.toContain(credential)
  })

  it('conforms to every shared language-neutral fixture', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('manifest.json', fixtureRoot), 'utf8'),
    ) as {
      readonly cases: readonly {
        readonly name: string
        readonly file: string
        readonly valid: boolean
        readonly errorCode?: string
      }[]
    }

    for (const fixture of manifest.cases) {
      const message = readFileSync(new URL(fixture.file, fixtureRoot), 'utf8')
      if (fixture.valid) {
        expect(() => parseProtocolJson(message), fixture.name).not.toThrow()
      } else {
        expect(() => parseProtocolJson(message), fixture.name).toThrowError(
          expect.objectContaining({ code: fixture.errorCode }),
        )
      }
    }
  })

  it('accepts unknown optional fields on batches, observations, and acks', () => {
    expect(
      parseProtocolMessage({
        ...batch(),
        futureEnvelopeField: true,
        observations: [{ ...observation(), futureObservationField: true }],
      }).kind,
    ).toBe('observations.batch')
    expect(
      parseProtocolMessage({
        protocolVersion: 1,
        kind: 'observations.ack',
        requestId: 'request-1',
        accepted: 1,
        duplicates: 0,
        futureAckField: true,
      }).kind,
    ).toBe('observations.ack')
  })

  it('rejects another major and every removed operational message kind', () => {
    expect(() =>
      parseProtocolMessage({ ...batch(), protocolVersion: 2 }),
    ).toThrowError(
      expect.objectContaining({ code: 'SPECTER_PROTOCOL_VERSION_MISMATCH' }),
    )

    for (const kind of [
      'capabilities.request',
      'command.request',
      'query.request',
      'subscription.request',
      'reaction-ticket.request',
    ]) {
      expect(() =>
        parseProtocolMessage({
          protocolVersion: 1,
          kind,
          requestId: 'removed-request',
        }),
      ).toThrowError(
        expect.objectContaining({ code: 'SPECTER_INVALID_MESSAGE' }),
      )
    }
  })

  it('validates metadata-only batches and the 100-item bound', () => {
    expect(() => assertRuntimeObservationBatch(batch())).not.toThrow()
    expect(() =>
      assertRuntimeObservationBatch(
        batch(
          Array.from({ length: 101 }, (_, index) => ({
            ...observation(`observation-${index}`),
            sequence: index,
          })),
        ),
      ),
    ).toThrowError(expect.objectContaining({ code: 'SPECTER_INVALID_MESSAGE' }))
  })

  it('validates observations independently for producer adapters', () => {
    expect(parseRuntimeObservation(observation())).toEqual(observation())
    expect(() =>
      parseRuntimeObservation({
        ...observation(),
        observedAt: '2026-01-02T03:04:05+01:00',
      }),
    ).toThrowError(expect.objectContaining({ code: 'SPECTER_INVALID_MESSAGE' }))
  })

  it('requires acknowledgement counts and rejected IDs to be valid', () => {
    expect(() =>
      parseProtocolMessage({
        protocolVersion: 1,
        kind: 'observations.ack',
        requestId: 'request-1',
        accepted: 1,
        duplicates: 0,
        rejectedObservationIds: ['observation-2'],
      }),
    ).not.toThrow()
    expect(() =>
      parseProtocolMessage({
        protocolVersion: 1,
        kind: 'observations.ack',
        requestId: 'request-1',
        accepted: -1,
        duplicates: 0,
      }),
    ).toThrowError(expect.objectContaining({ code: 'SPECTER_INVALID_MESSAGE' }))
  })
})
