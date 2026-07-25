export type LanternStage =
  | 'not-started'
  | 'name-hero'
  | 'approach-spirit'
  | 'roll-runes'
  | 'roll-ember'
  | 'reload-checkpoint'
  | 'choose-fate'
  | 'complete'

export type LanternState = {
  stage: LanternStage
  heroName: string | null
  approach: 'gentle' | 'bold' | 'cunning' | null
  pendingRoll: null | {
    rollId: string
    challenge: 'read-runes' | 'catch-ember'
    sides: 6 | 20
    count: 1
    target: number
  }
  lastOutcome: string | null
  ending: 'free' | 'bind' | 'befriend' | null
  rollsConfirmed: number
  checkpointRecovered: boolean
  transcript: Array<{
    id: string
    role: 'player' | 'dungeon-master'
    text: string
  }>
}

export async function getLanternState(): Promise<LanternState> {
  return request('/api/lantern/state')
}

export async function lanternCommand(
  path: string,
  body: unknown = {},
  idempotencyKey: string = crypto.randomUUID(),
  initiatedAt: string = new Date().toISOString(),
): Promise<LanternState> {
  const result = await request<{ state: LanternState }>(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-idempotency-key': idempotencyKey,
      'x-command-at': initiatedAt,
    },
    body: JSON.stringify(body),
  })
  return result.state
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const payload = (await response.json()) as { error?: string } & T
  if (!response.ok)
    throw new Error(payload.error ?? `Request failed with ${response.status}`)
  return payload
}
