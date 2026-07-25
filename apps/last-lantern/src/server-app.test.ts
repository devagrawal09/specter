import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  createLanternRealtimeSessionConfig,
  createLastLanternServer,
  realtimeInputTranscriptionModel,
} from './server-app'

const commandAt = '2026-07-25T12:00:00.000Z'
const openServers: Array<{ close(): Promise<void> }> = []
const tempDirectories: string[] = []

afterEach(async () => {
  for (const server of openServers.splice(0).reverse()) await server.close()
  for (const directory of tempDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

describe('Last Lantern HTTP server', () => {
  test('replays SQLite through completion, then resets and repeats', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'last-lantern-replay-'))
    tempDirectories.push(directory)
    const sqlitePath = join(directory, 'last-lantern.sqlite')
    let server = await openServer(sqlitePath)

    const started = await command(server, '/api/lantern/start', {}, 'start')
    expect(started.state.stage).toBe('name-hero')
    const duplicateStart = await command(
      server,
      '/api/lantern/start',
      {},
      'start',
    )
    expect(duplicateStart).toMatchObject({
      duplicate: true,
      state: { stage: 'name-hero' },
    })

    await command(server, '/api/lantern/name', { name: 'Mira' }, 'name')
    const approached = await command(
      server,
      '/api/lantern/approach',
      { approach: 'gentle' },
      'approach',
    )
    const runeRoll = approached.state.pendingRoll
    expect(runeRoll).toMatchObject({
      challenge: 'read-runes',
      sides: 20,
    })
    const duplicateApproach = await command(
      server,
      '/api/lantern/approach',
      { approach: 'gentle' },
      'approach',
    )
    expect(duplicateApproach).toMatchObject({
      duplicate: true,
      state: { pendingRoll: runeRoll },
    })

    const runes = await command(
      server,
      '/api/lantern/roll/confirm',
      {
        rollId: runeRoll?.rollId,
        challenge: runeRoll?.challenge,
        faces: [14],
      },
      'runes',
    )
    const emberRoll = runes.state.pendingRoll
    expect(emberRoll).toMatchObject({
      challenge: 'catch-ember',
      sides: 6,
    })
    const ember = await command(
      server,
      '/api/lantern/roll/confirm',
      {
        rollId: emberRoll?.rollId,
        challenge: emberRoll?.challenge,
        faces: [5],
      },
      'ember',
    )
    expect(ember.state.stage).toBe('reload-checkpoint')

    await closeServer(server)
    server = await openServer(sqlitePath)
    await expect(state(server)).resolves.toMatchObject({
      stage: 'reload-checkpoint',
      heroName: 'Mira',
      rollsConfirmed: 2,
    })

    await command(server, '/api/lantern/checkpoint/recovered', {}, 'checkpoint')
    await command(server, '/api/lantern/fate', { fate: 'befriend' }, 'fate')
    await closeServer(server)
    server = await openServer(sqlitePath)
    await expect(state(server)).resolves.toMatchObject({
      stage: 'complete',
      ending: 'befriend',
      checkpointRecovered: true,
    })

    const resetResponse = await server.app.request('/api/lantern/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'RESET LAST LANTERN' }),
    })
    expect(resetResponse.status).toBe(200)
    await expect(resetResponse.json()).resolves.toMatchObject({
      state: { stage: 'not-started' },
    })
    expect(
      readdirSync(directory).some((name) =>
        name.startsWith('last-lantern.sqlite.completed-'),
      ),
    ).toBe(true)

    const repeated = await command(
      server,
      '/api/lantern/start',
      {},
      'repeat-start',
    )
    expect(repeated.state.stage).toBe('name-hero')
  })

  test('returns JSON errors and keeps retry envelopes stable', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'last-lantern-http-'))
    tempDirectories.push(directory)
    const server = await openServer(join(directory, 'last-lantern.sqlite'))

    const missingTimestamp = await server.app.request('/api/lantern/start', {
      method: 'POST',
      headers: { 'x-idempotency-key': 'missing-time' },
    })
    expect(missingTimestamp.status).toBe(400)
    expect(missingTimestamp.headers.get('content-type')).toContain(
      'application/json',
    )
    await expect(missingTimestamp.json()).resolves.toEqual({
      error: 'x-command-at is required with x-idempotency-key.',
    })

    const invalidJson = await server.app.request('/api/lantern/name', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-idempotency-key': 'invalid-json',
        'x-command-at': commandAt,
      },
      body: '{',
    })
    expect(invalidJson.status).toBe(400)
    await expect(invalidJson.json()).resolves.toEqual({
      error: 'Invalid request body.',
    })

    await command(server, '/api/lantern/start', {}, 'stable-start')
    const first = await command(
      server,
      '/api/lantern/name',
      { name: 'Mira' },
      'stable-name',
    )
    const retry = await command(
      server,
      '/api/lantern/name',
      { name: 'Mira' },
      'stable-name',
    )
    expect(first.duplicate).toBe(false)
    expect(retry.duplicate).toBe(true)
  })

  test('configures input transcription and maps provider failures', async () => {
    const config = createLanternRealtimeSessionConfig()
    expect(config.audio.input.transcription).toEqual({
      model: realtimeInputTranscriptionModel,
      language: 'en',
    })
    expect(config.audio.input.turn_detection).toBeNull()

    const directory = mkdtempSync(join(tmpdir(), 'last-lantern-realtime-'))
    tempDirectories.push(directory)
    const providerFetch = vi.fn<typeof fetch>(async (_input, init) => {
      const form = init?.body
      expect(form).toBeInstanceOf(FormData)
      expect(
        JSON.parse(String((form as FormData).get('session'))),
      ).toMatchObject({
        audio: {
          input: {
            transcription: { model: realtimeInputTranscriptionModel },
          },
        },
      })
      return new Response('provider details must stay private', { status: 500 })
    })
    const server = await createLastLanternServer({
      sqlitePath: join(directory, 'last-lantern.sqlite'),
      realtimeApiKey: () => 'unit-test-placeholder',
      realtimeFetch: providerFetch,
    })
    openServers.push(server)

    const response = await server.app.request('/api/realtime/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: 'local-offer',
    })
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: 'OpenAI Realtime session creation failed.',
    })
    expect(providerFetch).toHaveBeenCalledOnce()
  })
})

type TestServer = Awaited<ReturnType<typeof createLastLanternServer>>
type CommandResult = {
  state: {
    stage: string
    heroName: string | null
    pendingRoll: null | {
      rollId: string
      challenge: 'read-runes' | 'catch-ember'
      sides: number
    }
  }
  duplicate: boolean
}

async function openServer(sqlitePath: string) {
  const server = await createLastLanternServer({ sqlitePath })
  openServers.push(server)
  return server
}

async function closeServer(server: TestServer) {
  const index = openServers.indexOf(server)
  if (index >= 0) openServers.splice(index, 1)
  await server.close()
}

async function state(server: TestServer) {
  const response = await server.app.request('/api/lantern/state')
  expect(response.status).toBe(200)
  return response.json()
}

async function command(
  server: TestServer,
  path: string,
  body: unknown,
  key: string,
): Promise<CommandResult> {
  const response = await server.app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-idempotency-key': key,
      'x-command-at': commandAt,
    },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(200)
  return response.json()
}
