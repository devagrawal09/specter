import { afterEach, expect, test, vi } from 'vitest'

import { lanternCommand, type LanternState } from './lantern-api'
import { LanternRealtimeClient } from './realtime-client'

vi.mock('./lantern-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lantern-api')>()
  return { ...original, lanternCommand: vi.fn() }
})

const initialState: LanternState = {
  stage: 'roll-runes',
  heroName: 'Mira',
  approach: 'gentle',
  pendingRoll: {
    rollId: 'roll-runes',
    challenge: 'read-runes',
    sides: 20,
    count: 1,
    target: 12,
  },
  lastOutcome: null,
  ending: null,
  rollsConfirmed: 0,
  checkpointRecovered: false,
  transcript: [],
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

test('uses one stable command timestamp for repeated Realtime events', async () => {
  vi.mocked(lanternCommand).mockResolvedValue(initialState)
  const onState = vi.fn()
  const onStatus = vi.fn()
  const client = new LanternRealtimeClient({
    onStatus,
    onState,
    onRollCandidate: vi.fn(),
  })
  const receiveEvent = (
    client as unknown as {
      receiveEvent(raw: unknown): Promise<void>
    }
  ).receiveEvent.bind(client)
  const event = JSON.stringify({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'utterance-1',
    transcript: 'I rolled fourteen.',
  })

  await receiveEvent(event)
  await receiveEvent(event)

  expect(lanternCommand).toHaveBeenCalledTimes(2)
  const first = vi.mocked(lanternCommand).mock.calls[0]
  const retry = vi.mocked(lanternCommand).mock.calls[1]
  expect(first?.slice(0, 3)).toEqual([
    '/api/lantern/speech',
    {
      utteranceId: 'utterance-1',
      role: 'player',
      text: 'I rolled fourteen.',
    },
    'utterance-1',
  ])
  expect(first?.[3]).toBe(retry?.[3])
  expect(onState).toHaveBeenCalledTimes(2)

  await receiveEvent('{')
  expect(onStatus).toHaveBeenLastCalledWith(
    'error',
    expect.stringContaining('JSON'),
  )
})

test('closes every partial resource when live setup fails', async () => {
  const track = {
    enabled: true,
    stop: vi.fn(),
  }
  const channel = {
    readyState: 'connecting',
    addEventListener: vi.fn(),
    close: vi.fn(),
    send: vi.fn(),
  }
  const peer = {
    connectionState: 'new',
    ontrack: null,
    addTrack: vi.fn(),
    createDataChannel: vi.fn(() => channel),
    addEventListener: vi.fn(),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'local-offer' })),
    setLocalDescription: vi.fn(),
    setRemoteDescription: vi.fn(),
    close: vi.fn(),
  }
  const audio = {
    autoplay: false,
    srcObject: null,
    remove: vi.fn(),
  }
  class TestPeerConnection {
    connectionState = peer.connectionState
    ontrack = peer.ontrack
    addTrack = peer.addTrack
    createDataChannel = peer.createDataChannel
    addEventListener = peer.addEventListener
    createOffer = peer.createOffer
    setLocalDescription = peer.setLocalDescription
    setRemoteDescription = peer.setRemoteDescription
    close = peer.close
  }
  vi.stubGlobal('RTCPeerConnection', TestPeerConnection)
  vi.stubGlobal('document', {
    createElement: vi.fn(() => audio),
  })
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(async () => ({
        getAudioTracks: () => [track],
      })),
    },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        { error: 'Live voice is unavailable in this test.' },
        { status: 503 },
      ),
    ),
  )
  const onStatus = vi.fn()
  const client = new LanternRealtimeClient({
    onStatus,
    onState: vi.fn(),
    onRollCandidate: vi.fn(),
  })

  await expect(client.connect(initialState)).rejects.toThrow(
    'Live voice is unavailable in this test.',
  )
  expect(track.enabled).toBe(false)
  expect(track.stop).toHaveBeenCalledOnce()
  expect(channel.close).toHaveBeenCalledOnce()
  expect(peer.close).toHaveBeenCalledOnce()
  expect(audio.remove).toHaveBeenCalledOnce()
  expect(onStatus).toHaveBeenCalledWith('connecting')
})
