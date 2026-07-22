import { createClient } from '@libsql/client/sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createCommandSlice,
  digestSpecification,
  event,
} from '@specter-ts/spec'
import { describe, expect, it } from 'vitest'
import { createSqliteSpecificationCatalog } from './specification-catalog'

describe('SQLite specification control catalog', () => {
  it('survives catalog recreation outside telemetry segments', async () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'specter-spec-catalog-')),
      'control.db',
    )
    const client = createClient({ url: `file:${path}` })
    const document = createCommandSlice('durableSlice')
      .description('Durable.')
      .scenarios({
        description: 'Runs.',
        given: [],
        when: {},
        expect: [event('ran', {})],
      })
    const digest = digestSpecification(document)
    const source = {
      application: 'app',
      environment: 'test',
      runtimeLanguage: 'rust',
      runtimeVersion: '1',
      instanceId: 'one',
      eventLogId: 'log',
    }
    const catalog = await createSqliteSpecificationCatalog(client)
    await catalog.publish(
      {
        protocolVersion: 1,
        kind: 'specifications.publish',
        requestId: 'one',
        source,
        specifications: [{ digest, document }],
      },
      new Date('2026-01-01T00:00:00Z'),
    )
    const reopened = await createSqliteSpecificationCatalog(client)
    expect(
      await reopened.list({ application: 'app', slice: 'durableSlice' }),
    ).toMatchObject([{ digest }])
    client.close()
  })
})
