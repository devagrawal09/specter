import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, test, vi } from 'vitest'

import * as schema from '../db/schema'
import {
  gmailActionAttempts,
  gmailCredentials,
  gmailSyncState,
} from '../db/adapter-schema'
import {
  createGmailService,
  extractText,
  normalizeThread,
} from './gmail.server'

const cleanup: (() => void)[] = []

afterEach(() => {
  for (const run of cleanup.splice(0)) run()
})

test('normalizes Gmail MIME and label state at the adapter boundary', () => {
  const bodyText = Buffer.from('Please review the build.').toString('base64url')
  expect(
    normalizeThread({
      id: 'thread-1',
      historyId: '102',
      messages: [
        {
          id: 'message-1',
          threadId: 'thread-1',
          historyId: '101',
          internalDate: '1784721600000',
          labelIds: ['INBOX', 'UNREAD'],
          snippet: 'Please review...',
          payload: {
            mimeType: 'multipart/alternative',
            headers: [
              { name: 'From', value: 'Ada <ada@example.com>' },
              { name: 'Subject', value: 'Review' },
            ],
            parts: [{ mimeType: 'text/plain', body: { data: bodyText } }],
          },
        },
      ],
    }),
  ).toEqual({
    threadId: 'thread-1',
    messageId: 'message-1',
    historyId: '102',
    sender: 'Ada <ada@example.com>',
    subject: 'Review',
    snippet: 'Please review...',
    bodyText: 'Please review the build.',
    receivedAt: new Date(1784721600000).toISOString(),
    unread: true,
    labels: ['INBOX', 'UNREAD'],
  })
})

test('preserves thread-level inbox and unread state when the latest message is sent mail', () => {
  expect(
    normalizeThread({
      id: 'thread-1',
      historyId: '103',
      messages: [
        {
          id: 'message-1',
          threadId: 'thread-1',
          internalDate: '1784721600000',
          labelIds: ['INBOX', 'UNREAD'],
          payload: { headers: [] },
        },
        {
          id: 'message-2',
          threadId: 'thread-1',
          internalDate: '1784721700000',
          labelIds: ['SENT'],
          payload: { headers: [] },
        },
      ],
    }),
  ).toMatchObject({
    messageId: 'message-2',
    unread: true,
    labels: ['INBOX', 'UNREAD', 'SENT'],
  })
})

test('strips executable HTML when plain text is unavailable', () => {
  const data = Buffer.from(
    '<style>.secret{display:none}</style><p>Hello <strong>Ada</strong></p><script>alert(1)</script>',
  ).toString('base64url')
  expect(extractText({ mimeType: 'text/html', body: { data } })).toBe(
    'Hello Ada',
  )
})

describe('Gmail synchronization durability', () => {
  test('does not advance Gmail history until the caller commits imported facts', async () => {
    const { db } = await testDatabase()
    await connect(db)
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/users/me/profile')) {
        return Response.json({
          emailAddress: 'owner@example.com',
          historyId: '200',
        })
      }
      if (url.includes('/users/me/threads?'))
        return Response.json({ threads: [] })
      throw new Error(`Unexpected request: ${url}`)
    })
    const gmail = createGmailService({ db, fetch })

    const batch = await gmail.sync()
    expect(batch).toMatchObject({
      threads: [],
      nextHistoryId: '200',
      full: true,
    })
    expect(await db.select().from(gmailSyncState).all()).toEqual([])

    await gmail.commitSyncState(batch.nextHistoryId)
    expect(await db.select().from(gmailSyncState).all()).toEqual([
      expect.objectContaining({ account: 'me', historyId: '200' }),
    ])
  })

  test('reports a deleted Gmail thread without turning its 404 into a full resync', async () => {
    const { db } = await testDatabase()
    await connect(db)
    await db
      .insert(gmailSyncState)
      .values({ account: 'me', historyId: '100' })
      .run()
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/users/me/history?')) {
        return Response.json({
          historyId: '101',
          history: [
            {
              messagesDeleted: [
                { message: { id: 'message-1', threadId: 'thread-1' } },
              ],
            },
          ],
        })
      }
      if (url.includes('/users/me/threads/thread-1?')) {
        return new Response(null, { status: 404 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    await expect(createGmailService({ db, fetch }).sync()).resolves.toEqual({
      threads: [],
      removedThreadIds: ['thread-1'],
      nextHistoryId: '101',
      full: false,
    })
    expect(await db.select().from(gmailSyncState).all()).toEqual([
      expect.objectContaining({ historyId: '100' }),
    ])
  })

  test('refreshes and retries once when Gmail rejects an unexpired access token', async () => {
    const { db } = await testDatabase()
    await connect(db)
    const fetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url === 'https://oauth2.googleapis.com/token') {
          expect(String(init?.body)).toContain(
            'refresh_token=test-refresh-token',
          )
          return Response.json({
            access_token: 'fresh-token',
            expires_in: 3600,
          })
        }
        const authorization = new Headers(init?.headers).get('authorization')
        if (authorization === 'Bearer test-access-token') {
          return new Response(null, { status: 401 })
        }
        expect(authorization).toBe('Bearer fresh-token')
        return Response.json(gmailThread(['INBOX']))
      },
    )

    await expect(
      createGmailService({
        db,
        fetch,
        env: {
          GOOGLE_CLIENT_ID: 'client-id',
          GOOGLE_CLIENT_SECRET: 'client-secret',
        },
      }).loadThread('thread-1'),
    ).resolves.toMatchObject({ threadId: 'thread-1', labels: ['INBOX'] })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  test('bounds concurrent thread reads during a full sync', async () => {
    const { db } = await testDatabase()
    await connect(db)
    let active = 0
    let maximumActive = 0
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/users/me/profile')) {
        return Response.json({
          emailAddress: 'owner@example.com',
          historyId: '200',
        })
      }
      if (url.includes('/users/me/threads?')) {
        return Response.json({
          threads: Array.from({ length: 12 }, (_, index) => ({
            id: `thread-${index}`,
          })),
        })
      }
      if (url.includes('/users/me/threads/thread-')) {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        const threadId = new URL(url).pathname.split('/').at(-1) ?? 'thread'
        return Response.json({
          ...gmailThread(['INBOX']),
          id: threadId,
          messages: [
            {
              ...gmailThread(['INBOX']).messages[0],
              threadId,
            },
          ],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const batch = await createGmailService({
      db,
      fetch,
      readConcurrency: 3,
    }).sync()

    expect(batch.threads).toHaveLength(12)
    expect(maximumActive).toBe(3)
  })

  test('retries transient Gmail reads without advancing the cursor early', async () => {
    const { db } = await testDatabase()
    await connect(db)
    let profileCalls = 0
    const sleep = vi.fn(async () => {})
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/users/me/profile')) {
        profileCalls += 1
        if (profileCalls === 1) return new Response(null, { status: 429 })
        return Response.json({
          emailAddress: 'owner@example.com',
          historyId: '200',
        })
      }
      if (url.includes('/users/me/threads?')) {
        return Response.json({ threads: [] })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    await expect(
      createGmailService({ db, fetch, sleep }).sync(),
    ).resolves.toMatchObject({ nextHistoryId: '200' })
    expect(profileCalls).toBe(2)
    expect(sleep).toHaveBeenCalledOnce()
    expect(await db.select().from(gmailSyncState).all()).toEqual([])
  })

  test('times out a hung Gmail read without advancing the cursor', async () => {
    const { db } = await testDatabase()
    await connect(db)
    const fetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (signal?.aborted) {
            reject(signal.reason)
            return
          }
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          })
        }),
    )

    await expect(
      createGmailService({
        db,
        fetch,
        requestTimeoutMs: 5,
        readAttempts: 1,
      }).sync(),
    ).rejects.toThrow('Gmail request timed out')
    expect(await db.select().from(gmailSyncState).all()).toEqual([])
  })

  test('refuses a fake Gmail endpoint in production', async () => {
    const { db } = await testDatabase()
    expect(() =>
      createGmailService({
        db,
        env: {
          NODE_ENV: 'production',
          SPECTER_MAIL_TEST_PROVIDERS: '1',
          GMAIL_API_BASE_URL: 'http://127.0.0.1:41740/gmail/v1',
        },
      }),
    ).toThrow(
      'GMAIL_API_BASE_URL is allowed only for non-production provider tests',
    )
  })
})

describe('Gmail mailbox-action reconciliation', () => {
  const effect = {
    actionId: 'action-1',
    threadId: 'thread-1',
    action: 'archive' as const,
    source: 'manual' as const,
    authorizedByRuleId: null,
  }

  test('reconciles a network-ambiguous mutation before retrying it', async () => {
    const { db } = await testDatabase()
    await connect(db)
    let mutationCalls = 0
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/modify')) {
        mutationCalls += 1
        throw new Error('Connection closed after request started')
      }
      if (url.includes('/users/me/threads/thread-1?')) {
        return Response.json(gmailThread([]))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const gmail = createGmailService({ db, fetch })

    await expect(
      gmail.applyMailboxAction(effect, 'delivery-1'),
    ).rejects.toThrow('Connection closed after request started')
    expect(
      await db
        .select({ status: gmailActionAttempts.status })
        .from(gmailActionAttempts)
        .where(eq(gmailActionAttempts.deliveryId, 'delivery-1'))
        .all(),
    ).toEqual([{ status: 'ambiguous' }])

    await expect(
      gmail.applyMailboxAction(effect, 'delivery-1'),
    ).resolves.toEqual({ status: 'applied', gmailHistoryId: '102' })
    expect(mutationCalls).toBe(1)
  })

  test('does not replay a definitively rejected mutation after a local crash', async () => {
    const { db } = await testDatabase()
    await connect(db)
    const fetch = vi.fn(async () => new Response(null, { status: 400 }))
    const gmail = createGmailService({ db, fetch })

    await expect(
      gmail.applyMailboxAction(effect, 'delivery-1'),
    ).resolves.toEqual({
      status: 'failed',
      reason: 'Gmail rejected the action with HTTP 400',
    })
    await expect(
      gmail.applyMailboxAction(effect, 'delivery-1'),
    ).resolves.toEqual({
      status: 'failed',
      reason: 'Gmail rejected the action with HTTP 400',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('surfaces reconciliation when an ambiguous thread disappears', async () => {
    const { db } = await testDatabase()
    await connect(db)
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/modify')) {
        throw new Error('Connection closed after request started')
      }
      if (url.includes('/users/me/threads/thread-1?')) {
        return new Response(null, { status: 404 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const gmail = createGmailService({ db, fetch, readAttempts: 1 })

    await expect(
      gmail.applyMailboxAction(effect, 'delivery-1'),
    ).rejects.toThrow('Connection closed after request started')
    await expect(
      gmail.applyMailboxAction(effect, 'delivery-1'),
    ).resolves.toEqual({
      status: 'reconciliationNeeded',
      reason: 'Gmail no longer exposes the thread after an ambiguous mutation',
    })
  })
})

async function testDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'personal-mail-gmail-test-'))
  const client = createClient({ url: `file:${join(directory, 'test.db')}` })
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') })
  cleanup.push(() => {
    client.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return { db }
}

function connect(db: Awaited<ReturnType<typeof testDatabase>>['db']) {
  return db
    .insert(gmailCredentials)
    .values({
      account: 'me',
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3_600_000,
      email: 'owner@example.com',
    })
    .run()
}

function gmailThread(labels: string[]) {
  return {
    id: 'thread-1',
    historyId: '102',
    messages: [
      {
        id: 'message-1',
        threadId: 'thread-1',
        historyId: '102',
        internalDate: '1784721600000',
        labelIds: labels,
        payload: { headers: [] },
      },
    ],
  }
}
