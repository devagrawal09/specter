import type { Client } from '@libsql/client/sqlite3'
import type {
  RuntimeSource,
  SpecificationPublication,
} from '@specter-ts/protocol'
import type { SliceSpecification, SpecificationDigest } from '@specter-ts/spec'

export type CollectedSpecification = {
  readonly digest: SpecificationDigest
  readonly document: SliceSpecification
  readonly firstPublishedAt: string
  readonly sources: readonly RuntimeSource[]
}

export type SpecificationFilter = {
  readonly application?: string
  readonly slice?: string
  readonly digest?: string
}

export type SpecificationCatalog = {
  publish(
    publication: SpecificationPublication,
    now: Date,
  ): Promise<readonly SpecificationDigest[]>
  list(filter?: SpecificationFilter): Promise<readonly CollectedSpecification[]>
  prune(digests: readonly SpecificationDigest[]): Promise<number>
}

export function createMemorySpecificationCatalog(): SpecificationCatalog {
  const records = new Map<SpecificationDigest, CollectedSpecification>()
  return {
    async publish(publication, now) {
      for (const published of publication.specifications) {
        const current = records.get(published.digest)
        const sources = uniqueSources([
          ...(current?.sources ?? []),
          publication.source,
        ])
        records.set(published.digest, {
          digest: published.digest,
          document: structuredClone(published.document),
          firstPublishedAt: current?.firstPublishedAt ?? now.toISOString(),
          sources,
        })
      }
      return publication.specifications.map((item) => item.digest)
    },
    async list(filter = {}) {
      return [...records.values()]
        .filter((item) => matches(item, filter))
        .map((item) => structuredClone(item))
    },
    async prune(digests) {
      return digests.reduce(
        (count, digest) => count + Number(records.delete(digest)),
        0,
      )
    },
  }
}

export async function createSqliteSpecificationCatalog(
  client: Client,
): Promise<SpecificationCatalog> {
  await client.execute(`CREATE TABLE IF NOT EXISTS specifications (
    digest TEXT PRIMARY KEY, document_json TEXT NOT NULL, first_published_at TEXT NOT NULL
  )`)
  await client.execute(`CREATE TABLE IF NOT EXISTS specification_sources (
    digest TEXT NOT NULL, application TEXT NOT NULL, environment TEXT NOT NULL,
    runtime_language TEXT NOT NULL, runtime_version TEXT NOT NULL,
    instance_id TEXT NOT NULL, event_log_id TEXT NOT NULL, last_published_at TEXT NOT NULL,
    PRIMARY KEY (digest, application, environment, runtime_language, runtime_version, instance_id, event_log_id),
    FOREIGN KEY (digest) REFERENCES specifications(digest) ON DELETE CASCADE
  )`)
  await client.execute('PRAGMA foreign_keys = ON')

  return {
    async publish(publication, now) {
      const publishedAt = now.toISOString()
      for (const item of publication.specifications) {
        await client.execute({
          sql: 'INSERT INTO specifications (digest, document_json, first_published_at) VALUES (?, ?, ?) ON CONFLICT(digest) DO NOTHING',
          args: [item.digest, JSON.stringify(item.document), publishedAt],
        })
        const source = publication.source
        await client.execute({
          sql: `INSERT INTO specification_sources
            (digest, application, environment, runtime_language, runtime_version, instance_id, event_log_id, last_published_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(digest, application, environment, runtime_language, runtime_version, instance_id, event_log_id)
            DO UPDATE SET last_published_at = excluded.last_published_at`,
          args: [
            item.digest,
            source.application,
            source.environment,
            source.runtimeLanguage,
            source.runtimeVersion,
            source.instanceId,
            source.eventLogId,
            publishedAt,
          ],
        })
      }
      return publication.specifications.map((item) => item.digest)
    },
    async list(filter = {}) {
      const result = await client.execute({
        sql: `SELECT s.digest, s.document_json, s.first_published_at,
          a.application, a.environment, a.runtime_language, a.runtime_version, a.instance_id, a.event_log_id
          FROM specifications s LEFT JOIN specification_sources a ON a.digest = s.digest
          WHERE (? IS NULL OR a.application = ?) AND (? IS NULL OR s.digest = ?)
          ORDER BY s.first_published_at DESC`,
        args: [
          filter.application ?? null,
          filter.application ?? null,
          filter.digest ?? null,
          filter.digest ?? null,
        ],
      })
      const records = new Map<string, CollectedSpecification>()
      for (const row of result.rows) {
        const digest = String(row.digest) as SpecificationDigest
        const document = JSON.parse(
          String(row.document_json),
        ) as SliceSpecification
        if (filter.slice && document.name !== filter.slice) continue
        const current = records.get(digest)
        const source =
          row.application === null
            ? undefined
            : {
                application: String(row.application),
                environment: String(row.environment),
                runtimeLanguage: String(row.runtime_language),
                runtimeVersion: String(row.runtime_version),
                instanceId: String(row.instance_id),
                eventLogId: String(row.event_log_id),
              }
        records.set(digest, {
          digest,
          document,
          firstPublishedAt: String(row.first_published_at),
          sources: source
            ? [...(current?.sources ?? []), source]
            : (current?.sources ?? []),
        })
      }
      return [...records.values()]
    },
    async prune(digests) {
      let removed = 0
      for (const digest of digests) {
        const result = await client.execute({
          sql: 'DELETE FROM specifications WHERE digest = ?',
          args: [digest],
        })
        removed += result.rowsAffected
      }
      return removed
    },
  }
}

function matches(item: CollectedSpecification, filter: SpecificationFilter) {
  return (
    (!filter.digest || item.digest === filter.digest) &&
    (!filter.slice || item.document.name === filter.slice) &&
    (!filter.application ||
      item.sources.some((source) => source.application === filter.application))
  )
}
function uniqueSources(sources: readonly RuntimeSource[]) {
  return [
    ...new Map(
      sources.map((source) => [JSON.stringify(source), source]),
    ).values(),
  ]
}
