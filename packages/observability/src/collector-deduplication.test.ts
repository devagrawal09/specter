import { createClient } from '@libsql/client/sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  RuntimeObservation,
  RuntimeObservationBatch,
} from '@specter-ts/protocol'
import { afterEach, describe, expect, it } from 'vitest'

import {
  acceptObservationReservation,
  prepareObservationDeduplication,
  releaseObservationReservation,
  reserveObservations,
} from './collector-deduplication'
import { SegmentCoordinator } from './segment-coordinator'

const observation: RuntimeObservation = {
  observationId: 'shared-observation',
  sequence: 1,
  observedAt: '2026-07-18T12:00:00.000Z',
  source: {
    application: 'todo',
    environment: 'test',
    runtimeLanguage: 'typescript',
    runtimeVersion: 'test',
    instanceId: 'instance-1',
    eventLogId: 'todo-log',
  },
  kind: 'command.started',
  operationId: 'command-1',
}

const batch: RuntimeObservationBatch = {
  protocolVersion: 1,
  kind: 'observations.batch',
  requestId: 'batch-1',
  observations: [observation],
}

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function controlClient() {
  const directory = mkdtempSync(join(tmpdir(), 'specter-observation-dedup-'))
  temporaryDirectories.push(directory)
  return createClient({ url: `file:${join(directory, 'control.db')}` })
}

describe('collector cross-segment observation deduplication', () => {
  it('atomically reserves one concurrent retry while rotation occurs', async () => {
    const client = controlClient()
    await prepareObservationDeduplication(client)
    const segments = new SegmentCoordinator({
      initial: { id: 'expired' },
      shouldRotate: (segment) => segment.id === 'expired',
      open: async () => ({ id: 'active' }),
      retire() {},
      close() {},
    })

    const [firstLease, secondLease] = await Promise.all([
      segments.acquire(),
      segments.acquire(),
    ])
    expect(firstLease.segment).toBe(secondLease.segment)
    const results = await Promise.all([
      reserveObservations(batch, client, 'request-a'),
      reserveObservations(batch, client, 'request-b'),
    ])
    const reserved = results.find((result) => result.status === 'reserved')
    expect(results.map((result) => result.status).sort()).toEqual([
      'busy',
      'reserved',
    ])
    if (!reserved || reserved.status !== 'reserved') {
      throw new Error('Expected one reservation')
    }

    await acceptObservationReservation(
      reserved.reservation,
      reserved.reservation.batch.observations,
      client,
    )
    const retried = await reserveObservations(batch, client, 'request-c')
    expect(retried).toMatchObject({
      status: 'reserved',
      reservation: { duplicates: 1, batch: { observations: [] } },
    })

    firstLease.release()
    secondLease.release()
    await segments.shutdown()
    client.close()
  })

  it('releases failed reservations and clears abandoned ones on restart', async () => {
    const client = controlClient()
    await prepareObservationDeduplication(client)
    const first = await reserveObservations(batch, client, 'failed-request')
    if (first.status !== 'reserved') throw new Error('Expected reservation')
    await releaseObservationReservation(first.reservation, client)
    await expect(
      reserveObservations(batch, client, 'retry-request'),
    ).resolves.toMatchObject({
      status: 'reserved',
      reservation: { duplicates: 0, batch: { observations: [observation] } },
    })

    // Startup recovery removes reservations that could never still be active.
    await prepareObservationDeduplication(client)
    await expect(
      reserveObservations(batch, client, 'after-restart'),
    ).resolves.toMatchObject({
      status: 'reserved',
      reservation: { duplicates: 0, batch: { observations: [observation] } },
    })
    client.close()
  })
})
