import { eq, lt } from 'drizzle-orm'
import { z } from 'zod'

import {
  gmailActionAttempts,
  gmailCredentials,
  gmailOauthStates,
  gmailSyncState,
} from '../db/adapter-schema'
import type { ApplyMailboxActionEffect } from '../features/mail/apply-mailbox-action-reaction/impl'
import type { GmailActionResult } from '../features/mail/apply-mailbox-action-reaction/plugin.server'
import type { SqliteDb } from '../db/specter-sqlite'

type Database = SqliteDb

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
})

const profileSchema = z.object({
  emailAddress: z.string(),
  historyId: z.string(),
})
const threadRefSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
})
const listThreadsSchema = z.object({
  threads: z.array(threadRefSchema).optional(),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().optional(),
})
const headerSchema = z.object({ name: z.string(), value: z.string() })
const partSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    headers: z.array(headerSchema).optional(),
    body: z.object({ data: z.string().optional() }).optional(),
    parts: z.array(partSchema).optional(),
  }),
)
const messageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  historyId: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  internalDate: z.string().optional(),
  payload: partSchema.optional(),
})
const threadSchema = z.object({
  id: z.string(),
  historyId: z.string().optional(),
  messages: z.array(messageSchema).optional(),
})
const historySchema = z.object({
  history: z
    .array(
      z.object({
        messages: z.array(threadRefSchema).optional(),
        messagesAdded: z
          .array(z.object({ message: threadRefSchema }))
          .optional(),
        labelsAdded: z.array(z.object({ message: threadRefSchema })).optional(),
        labelsRemoved: z
          .array(z.object({ message: threadRefSchema }))
          .optional(),
        messagesDeleted: z
          .array(z.object({ message: threadRefSchema }))
          .optional(),
      }),
    )
    .optional(),
  historyId: z.string(),
  nextPageToken: z.string().optional(),
})

type GmailPart = {
  mimeType?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string }
  parts?: GmailPart[]
}

export type NormalizedGmailThread = {
  threadId: string
  messageId: string
  historyId: string
  sender: string
  subject: string
  snippet: string
  bodyText: string
  receivedAt: string
  unread: boolean
  labels: string[]
}

export type GmailSyncBatch = {
  threads: NormalizedGmailThread[]
  removedThreadIds: string[]
  nextHistoryId: string
  full: boolean
}

export function createGmailService(options: {
  db: Database
  fetch?: typeof fetch
  env?: NodeJS.ProcessEnv
  now?: () => Date
}) {
  const db = options.db
  const fetchImplementation = options.fetch ?? fetch
  const env = options.env ?? process.env
  const now = options.now ?? (() => new Date())

  function oauthConfiguration() {
    const clientId = env.GOOGLE_CLIENT_ID
    const clientSecret = env.GOOGLE_CLIENT_SECRET
    const redirectUri =
      env.GOOGLE_REDIRECT_URI ?? 'http://127.0.0.1:41738/auth/google/callback'
    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth is not configured')
    }
    return { clientId, clientSecret, redirectUri }
  }

  async function createAuthorizationUrl() {
    const oauth = oauthConfiguration()
    const state = crypto.randomUUID()
    await db
      .delete(gmailOauthStates)
      .where(lt(gmailOauthStates.expiresAt, now().getTime()))
      .run()
    await db
      .insert(gmailOauthStates)
      .values({ state, expiresAt: now().getTime() + 10 * 60_000 })
      .run()
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.search = new URLSearchParams({
      client_id: oauth.clientId,
      redirect_uri: oauth.redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/gmail.modify',
      access_type: 'offline',
      prompt: 'consent',
      state,
    }).toString()
    return url.toString()
  }

  async function finishAuthorization(code: string, state: string) {
    const [storedState] = await db
      .select()
      .from(gmailOauthStates)
      .where(eq(gmailOauthStates.state, state))
      .all()
    await db
      .delete(gmailOauthStates)
      .where(eq(gmailOauthStates.state, state))
      .run()
    if (!storedState || storedState.expiresAt < now().getTime()) {
      throw new Error('OAuth state is invalid or expired')
    }
    const oauth = oauthConfiguration()
    const response = await fetchImplementation(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: oauth.clientId,
          client_secret: oauth.clientSecret,
          redirect_uri: oauth.redirectUri,
          grant_type: 'authorization_code',
        }),
      },
    )
    if (!response.ok)
      throw new Error(
        `OAuth token exchange failed with HTTP ${response.status}`,
      )
    const token = tokenSchema.parse(await response.json())
    await db
      .insert(gmailCredentials)
      .values({
        account: 'me',
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: now().getTime() + token.expires_in * 1000,
      })
      .onConflictDoUpdate({
        target: gmailCredentials.account,
        set: {
          accessToken: token.access_token,
          ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
          expiresAt: now().getTime() + token.expires_in * 1000,
        },
      })
      .run()
    const profile = profileSchema.parse(await gmailJson('/users/me/profile'))
    await db
      .update(gmailCredentials)
      .set({ email: profile.emailAddress })
      .where(eq(gmailCredentials.account, 'me'))
      .run()
    return profile.emailAddress
  }

  async function connectionStatus() {
    const [credentials] = await db
      .select({ email: gmailCredentials.email })
      .from(gmailCredentials)
      .where(eq(gmailCredentials.account, 'me'))
      .all()
    return {
      connected: Boolean(credentials),
      email: credentials?.email ?? null,
    }
  }

  async function sync(): Promise<GmailSyncBatch> {
    const [state] = await db
      .select()
      .from(gmailSyncState)
      .where(eq(gmailSyncState.account, 'me'))
      .all()
    try {
      return state?.historyId
        ? await incrementalSync(state.historyId)
        : await fullSync()
    } catch (cause) {
      if (cause instanceof GmailHttpError && cause.status === 404) {
        return fullSync()
      }
      throw cause
    }
  }

  async function fullSync() {
    const profile = profileSchema.parse(await gmailJson('/users/me/profile'))
    const threadIds: string[] = []
    let pageToken: string | undefined
    do {
      const query = new URLSearchParams({
        maxResults: '50',
        q: 'in:inbox newer_than:90d',
      })
      if (pageToken) query.set('pageToken', pageToken)
      const page = listThreadsSchema.parse(
        await gmailJson(`/users/me/threads?${query}`),
      )
      threadIds.push(...(page.threads ?? []).map((thread) => thread.id))
      pageToken = threadIds.length < 200 ? page.nextPageToken : undefined
    } while (pageToken)
    const threads = await Promise.all(threadIds.map(loadThread))
    return {
      threads,
      removedThreadIds: [],
      nextHistoryId: profile.historyId,
      full: true,
    }
  }

  async function incrementalSync(startHistoryId: string) {
    const threadIds = new Set<string>()
    const deletedThreadIds = new Set<string>()
    let pageToken: string | undefined
    let latestHistoryId = startHistoryId
    do {
      const query = new URLSearchParams({ startHistoryId, maxResults: '500' })
      if (pageToken) query.set('pageToken', pageToken)
      const page = historySchema.parse(
        await gmailJson(`/users/me/history?${query}`),
      )
      latestHistoryId = page.historyId
      for (const entry of page.history ?? []) {
        for (const message of entry.messages ?? [])
          threadIds.add(message.threadId ?? message.id)
        for (const item of entry.messagesAdded ?? [])
          threadIds.add(item.message.threadId ?? item.message.id)
        for (const item of entry.labelsAdded ?? [])
          threadIds.add(item.message.threadId ?? item.message.id)
        for (const item of entry.labelsRemoved ?? [])
          threadIds.add(item.message.threadId ?? item.message.id)
        for (const item of entry.messagesDeleted ?? []) {
          const threadId = item.message.threadId ?? item.message.id
          threadIds.add(threadId)
          deletedThreadIds.add(threadId)
        }
      }
      pageToken = page.nextPageToken
    } while (pageToken)
    const loaded = await Promise.all(
      [...threadIds].map(async (threadId) => {
        try {
          return { thread: await loadThread(threadId) }
        } catch (cause) {
          if (cause instanceof GmailHttpError && cause.status === 404) {
            return { removedThreadId: threadId }
          }
          throw cause
        }
      }),
    )
    const threads = loaded.flatMap((item) => (item.thread ? [item.thread] : []))
    const removedThreadIds = new Set(
      loaded.flatMap((item) =>
        item.removedThreadId ? [item.removedThreadId] : [],
      ),
    )
    for (const thread of threads) deletedThreadIds.delete(thread.threadId)
    for (const threadId of deletedThreadIds) removedThreadIds.add(threadId)
    return {
      threads,
      removedThreadIds: [...removedThreadIds],
      nextHistoryId: latestHistoryId,
      full: false,
    }
  }

  async function loadThread(threadId: string) {
    const thread = threadSchema.parse(
      await gmailJson(
        `/users/me/threads/${encodeURIComponent(threadId)}?format=full`,
      ),
    )
    return normalizeThread(thread)
  }

  async function commitSyncState(historyId: string) {
    await db
      .insert(gmailSyncState)
      .values({ account: 'me', historyId, lastSyncedAt: now().toISOString() })
      .onConflictDoUpdate({
        target: gmailSyncState.account,
        set: { historyId, lastSyncedAt: now().toISOString() },
      })
      .run()
  }

  async function applyMailboxAction(
    effect: ApplyMailboxActionEffect,
    deliveryId: string,
  ): Promise<GmailActionResult> {
    const [existing] = await db
      .select()
      .from(gmailActionAttempts)
      .where(eq(gmailActionAttempts.deliveryId, deliveryId))
      .all()
    if (existing?.status === 'failed') {
      return {
        status: 'failed' as const,
        reason: existing.error ?? 'Gmail previously rejected the action',
      }
    }
    if (existing) {
      const current = await loadThread(effect.threadId)
      if (actionIsVisible(current.labels, effect.action)) {
        const result = {
          status: 'applied' as const,
          gmailHistoryId: current.historyId,
        }
        await markAttempt(deliveryId, 'applied')
        return result
      }
    }

    await db
      .insert(gmailActionAttempts)
      .values({
        deliveryId,
        actionId: effect.actionId,
        threadId: effect.threadId,
        action: effect.action,
        status: 'started',
        updatedAt: now().toISOString(),
      })
      .onConflictDoUpdate({
        target: gmailActionAttempts.deliveryId,
        set: { status: 'started', error: null, updatedAt: now().toISOString() },
      })
      .run()

    try {
      const labels = labelsForAction(effect.action)
      const response = await gmailFetch(
        `/users/me/threads/${encodeURIComponent(effect.threadId)}/modify`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(labels),
        },
      )
      if (!response.ok) {
        const reason = `Gmail rejected the action with HTTP ${response.status}`
        if (
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500
        ) {
          await markAttempt(deliveryId, 'ambiguous', reason)
          throw new GmailRetryableError(reason)
        }
        await markAttempt(deliveryId, 'failed', reason)
        return { status: 'failed', reason }
      }
      const updated = threadSchema.parse(await response.json())
      const historyId =
        updated.historyId ?? (await loadThread(effect.threadId)).historyId
      await markAttempt(deliveryId, 'applied')
      return { status: 'applied', gmailHistoryId: historyId }
    } catch (cause) {
      if (cause instanceof GmailHttpError) {
        const reason = cause.message
        await markAttempt(deliveryId, 'failed', reason)
        return { status: 'failed', reason }
      }
      const reason = cause instanceof Error ? cause.message : String(cause)
      await markAttempt(deliveryId, 'ambiguous', reason)
      throw cause
    }
  }

  async function markAttempt(
    deliveryId: string,
    status: string,
    error?: string,
  ) {
    await db
      .update(gmailActionAttempts)
      .set({ status, error: error ?? null, updatedAt: now().toISOString() })
      .where(eq(gmailActionAttempts.deliveryId, deliveryId))
      .run()
  }

  async function gmailJson(path: string) {
    const response = await gmailFetch(path)
    if (!response.ok) throw new GmailHttpError(response.status)
    return response.json()
  }

  async function gmailFetch(path: string, init: RequestInit = {}) {
    const url = `https://gmail.googleapis.com/gmail/v1${path}`
    const accessToken = await validAccessToken()
    const response = await fetchImplementation(url, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${accessToken}` },
    })
    if (response.status !== 401) return response
    const refreshedToken = await validAccessToken(true)
    return fetchImplementation(url, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${refreshedToken}` },
    })
  }

  async function validAccessToken(forceRefresh = false) {
    const [credentials] = await db
      .select()
      .from(gmailCredentials)
      .where(eq(gmailCredentials.account, 'me'))
      .all()
    if (!credentials) throw new Error('Gmail is not connected')
    if (!forceRefresh && credentials.expiresAt > now().getTime() + 60_000)
      return credentials.accessToken
    if (!credentials.refreshToken)
      throw new Error('Gmail refresh token is unavailable')
    const oauth = oauthConfiguration()
    const response = await fetchImplementation(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: oauth.clientId,
          client_secret: oauth.clientSecret,
          refresh_token: credentials.refreshToken,
          grant_type: 'refresh_token',
        }),
      },
    )
    if (!response.ok)
      throw new Error(`OAuth token refresh failed with HTTP ${response.status}`)
    const token = tokenSchema.parse(await response.json())
    await db
      .update(gmailCredentials)
      .set({
        accessToken: token.access_token,
        expiresAt: now().getTime() + token.expires_in * 1000,
      })
      .where(eq(gmailCredentials.account, 'me'))
      .run()
    return token.access_token
  }

  return {
    createAuthorizationUrl,
    finishAuthorization,
    connectionStatus,
    sync,
    commitSyncState,
    loadThread,
    applyMailboxAction,
  }
}

export class GmailHttpError extends Error {
  constructor(readonly status: number) {
    super(`Gmail API returned HTTP ${status}`)
  }
}

class GmailRetryableError extends Error {}

export function normalizeThread(
  thread: z.infer<typeof threadSchema>,
): NormalizedGmailThread {
  const messages = [...(thread.messages ?? [])].sort(
    (left, right) =>
      Number(left.internalDate ?? 0) - Number(right.internalDate ?? 0),
  )
  const message = messages.at(-1)
  if (!message)
    throw new Error(`Gmail thread ${thread.id} contains no messages`)
  const headers = new Map(
    (message.payload?.headers ?? []).map((header) => [
      header.name.toLowerCase(),
      header.value,
    ]),
  )
  const receivedAt = Number(message.internalDate)
  const labels = [
    ...new Set(messages.flatMap((candidate) => candidate.labelIds ?? [])),
  ]
  return {
    threadId: thread.id,
    messageId: message.id,
    historyId: thread.historyId ?? message.historyId ?? '0',
    sender: headers.get('from') ?? '',
    subject: headers.get('subject') ?? '(no subject)',
    snippet: message.snippet ?? '',
    bodyText: extractText(message.payload),
    receivedAt: Number.isFinite(receivedAt)
      ? new Date(receivedAt).toISOString()
      : new Date(headers.get('date') ?? 0).toISOString(),
    unread: labels.includes('UNREAD'),
    labels,
  }
}

export function extractText(part?: GmailPart): string {
  if (!part) return ''
  if (part.mimeType === 'text/plain' && part.body?.data)
    return decodeBase64Url(part.body.data)
  for (const child of part.parts ?? []) {
    const text = extractText(child)
    if (text) return text
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return decodeBase64Url(part.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
  return ''
}

function decodeBase64Url(value: string) {
  return Buffer.from(
    value.replaceAll('-', '+').replaceAll('_', '/'),
    'base64',
  ).toString('utf8')
}

function labelsForAction(action: ApplyMailboxActionEffect['action']) {
  if (action === 'archive')
    return { addLabelIds: [], removeLabelIds: ['INBOX'] }
  if (action === 'markRead')
    return { addLabelIds: [], removeLabelIds: ['UNREAD'] }
  return { addLabelIds: ['STARRED'], removeLabelIds: [] }
}

function actionIsVisible(
  labels: string[],
  action: ApplyMailboxActionEffect['action'],
) {
  if (action === 'archive') return !labels.includes('INBOX')
  if (action === 'markRead') return !labels.includes('UNREAD')
  return labels.includes('STARRED')
}
