import { createClient } from '@libsql/client/sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSpecterSqlitePersistence,
  prepareSpecterSqlite,
} from '@specter-ts/sqlite'
import type {
  RuntimeObservation,
  RuntimeObservationBatch,
} from '@specter-ts/protocol'
import { afterEach, describe, expect, it } from 'vitest'

import {
  acceptObservationReservation,
  prepareObservationDeduplication,
  reconcileObservationReservations,
  releaseObservationReservation,
  reserveObservations,
} from './collector-deduplication'
import { createCollectorState } from './collector-model'
import { createSpecterObservabilityCollector } from './collector'
import { SegmentCoordinator } from './segment-coordinator'
import { existingSegmentPaths } from './segment-storage'

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

  it('releases failed reservations and clears uncommitted ones on restart', async () => {
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

    // Startup recovery releases reservations not found in any durable segment.
    await prepareObservationDeduplication(client)
    await expect(
      reserveObservations(batch, client, 'after-restart'),
    ).resolves.toMatchObject({
      status: 'reserved',
      reservation: { duplicates: 0, batch: { observations: [observation] } },
    })
    client.close()
  })

  it('never reclaims a live reservation based only on its age', async () => {
    const client = controlClient()
    const startedAt = new Date('2026-07-18T12:00:00.000Z')
    await prepareObservationDeduplication(client, startedAt)
    const first = await reserveObservations(
      batch,
      client,
      'slow-live-request',
      startedAt,
    )
    if (first.status !== 'reserved') throw new Error('Expected reservation')

    await expect(
      reserveObservations(
        batch,
        client,
        'retry-after-six-minutes',
        new Date('2026-07-18T12:06:00.000Z'),
      ),
    ).resolves.toMatchObject({
      status: 'busy',
      reservationIds: ['slow-live-request'],
    })

    await acceptObservationReservation(
      first.reservation,
      first.reservation.batch.observations,
      client,
      new Date('2026-07-18T12:06:01.000Z'),
    )
    await expect(
      reserveObservations(
        batch,
        client,
        'retry-after-completion',
        new Date('2026-07-18T12:06:02.000Z'),
      ),
    ).resolves.toMatchObject({
      status: 'reserved',
      reservation: { duplicates: 1, batch: { observations: [] } },
    })
    client.close()
  })

  it('retains accepted identities through the retry window and prunes them afterwards', async () => {
    const client = controlClient()
    const acceptedAt = new Date('2026-07-18T12:00:00.000Z')
    await prepareObservationDeduplication(client, acceptedAt)
    const first = await reserveObservations(
      batch,
      client,
      'accepted-request',
      acceptedAt,
    )
    if (first.status !== 'reserved') throw new Error('Expected reservation')
    await acceptObservationReservation(
      first.reservation,
      first.reservation.batch.observations,
      client,
      acceptedAt,
    )

    await expect(
      reserveObservations(
        batch,
        client,
        'within-window-retry',
        new Date('2026-07-20T11:59:59.000Z'),
      ),
    ).resolves.toMatchObject({
      status: 'reserved',
      reservation: { duplicates: 1, batch: { observations: [] } },
    })

    await expect(
      reserveObservations(
        batch,
        client,
        'after-window-retry',
        new Date('2026-07-20T12:00:01.000Z'),
      ),
    ).resolves.toMatchObject({
      status: 'reserved',
      reservation: { duplicates: 0, batch: { observations: [observation] } },
    })
    client.close()
  })

  it('recovers a durable segment commit after live control-index finalization fails', async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'specter-dedup-live-recovery-'),
    )
    temporaryDirectories.push(directory)
    const segmentPath = join(directory, 'collector-20260718120000000.db')
    const client = createClient({
      url: `file:${join(directory, 'control.db')}`,
    })
    await prepareObservationDeduplication(client)
    const reserved = await reserveObservations(
      batch,
      client,
      'failed-finalization',
    )
    if (reserved.status !== 'reserved') throw new Error('Expected reservation')

    const segment = createClient({ url: `file:${segmentPath}` })
    await prepareSpecterSqlite(segment)
    const persistence = createSpecterSqlitePersistence(segment)
    const collector = await createSpecterObservabilityCollector({
      eventLog: persistence.eventLog,
      store: persistence.createSliceStoreService(createCollectorState),
    })
    await collector.ingest(reserved.reservation.batch)

    const blocked = await reserveObservations(batch, client, 'live-retry')
    expect(blocked).toMatchObject({
      status: 'busy',
      reservationIds: ['failed-finalization'],
    })
    if (blocked.status !== 'busy') throw new Error('Expected busy retry')

    await reconcileObservationReservations(
      client,
      [segmentPath],
      new Date(),
      blocked.reservationIds,
    )
    await expect(
      reserveObservations(batch, client, 'recovered-retry'),
    ).resolves.toMatchObject({
      status: 'reserved',
      reservation: { duplicates: 1, batch: { observations: [] } },
    })

    const count = await segment.execute(
      "SELECT COUNT(*) AS count FROM specter_events WHERE type = 'runtime-observation-recorded'",
    )
    expect(Number(count.rows[0]?.count)).toBe(1)
    segment.close()
    client.close()
  })

  it('recovers a segment commit after a crash and rotation without accepting a duplicate retry', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'specter-dedup-recovery-'))
    temporaryDirectories.push(directory)
    const controlPath = join(directory, 'collector-control.db')
    const committedSegmentPath = join(
      directory,
      'collector-20260718120000000.db',
    )
    const newerSegmentPath = join(directory, 'collector-20260718120100000.db')

    const beforeCrash = createClient({ url: `file:${controlPath}` })
    await prepareObservationDeduplication(beforeCrash)
    const reserved = await reserveObservations(
      batch,
      beforeCrash,
      'crashed-request',
    )
    if (reserved.status !== 'reserved') throw new Error('Expected reservation')

    const committedSegment = createClient({
      url: `file:${committedSegmentPath}`,
    })
    await prepareSpecterSqlite(committedSegment)
    const persistence = createSpecterSqlitePersistence(committedSegment)
    const collector = await createSpecterObservabilityCollector({
      eventLog: persistence.eventLog,
      store: persistence.createSliceStoreService(createCollectorState),
    })
    await collector.ingest(reserved.reservation.batch)
    // Simulate losing the response and crashing before the control index can
    // transition this reservation to accepted.
    committedSegment.close()
    beforeCrash.close()

    // A newer segment can exist by the time the collector restarts. Recovery
    // must inspect the retired segment too, rather than only the latest file.
    const newerSegment = createClient({ url: `file:${newerSegmentPath}` })
    await prepareSpecterSqlite(newerSegment)
    newerSegment.close()

    const afterCrash = createClient({ url: `file:${controlPath}` })
    const discoveredSegments = existingSegmentPaths(
      join(directory, 'collector'),
    )
    expect(discoveredSegments).toEqual([committedSegmentPath, newerSegmentPath])
    await prepareObservationDeduplication(
      afterCrash,
      new Date(),
      discoveredSegments,
    )
    await expect(
      reserveObservations(batch, afterCrash, 'retry-after-crash'),
    ).resolves.toMatchObject({
      status: 'reserved',
      reservation: { duplicates: 1, batch: { observations: [] } },
    })

    const oldRead = createClient({ url: `file:${committedSegmentPath}` })
    const newRead = createClient({ url: `file:${newerSegmentPath}` })
    const [oldCount, newCount] = await Promise.all([
      oldRead.execute(
        "SELECT COUNT(*) AS count FROM specter_events WHERE type = 'runtime-observation-recorded'",
      ),
      newRead.execute(
        "SELECT COUNT(*) AS count FROM specter_events WHERE type = 'runtime-observation-recorded'",
      ),
    ])
    expect(Number(oldCount.rows[0]?.count)).toBe(1)
    expect(Number(newCount.rows[0]?.count)).toBe(0)
    oldRead.close()
    newRead.close()
    afterCrash.close()
  })
})
