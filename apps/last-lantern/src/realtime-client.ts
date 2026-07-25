import { lanternCommand, type LanternState } from './lantern-api'

type Status =
  | 'offline'
  | 'connecting'
  | 'ready'
  | 'listening'
  | 'speaking'
  | 'error'

export class LanternRealtimeClient {
  private peer?: RTCPeerConnection
  private channel?: RTCDataChannel
  private microphone?: MediaStreamTrack
  private remoteAudio?: HTMLAudioElement
  private onStatus: (status: Status, detail?: string) => void
  private onState: (state: LanternState) => void
  private onRollCandidate: (faces: number[]) => void
  private talking = false
  private commandTimes = new Map<string, string>()

  constructor(callbacks: {
    onStatus(status: Status, detail?: string): void
    onState(state: LanternState): void
    onRollCandidate(faces: number[]): void
  }) {
    this.onStatus = callbacks.onStatus
    this.onState = callbacks.onState
    this.onRollCandidate = callbacks.onRollCandidate
  }

  async connect(state: LanternState) {
    this.close()
    this.onStatus('connecting')
    const peer = new RTCPeerConnection()
    const audio = document.createElement('audio')
    audio.autoplay = true
    this.peer = peer
    this.remoteAudio = audio
    peer.ontrack = (event) => {
      audio.srcObject = event.streams[0]
      this.onStatus('speaking')
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      const track = stream.getAudioTracks()[0]
      if (!track) throw new Error('No microphone audio track is available.')
      track.enabled = false
      this.microphone = track
      peer.addTrack(track, stream)
      const channel = peer.createDataChannel('oai-events')
      this.channel = channel
      channel.addEventListener('message', (event) => {
        void this.receiveEvent(event.data)
      })
      channel.addEventListener('open', () => {
        this.onStatus('ready')
        this.sendText(
          `Begin The Last Lantern now. Current durable state: ${JSON.stringify(state)}. Continue from exactly this state.`,
        )
      })
      channel.addEventListener('close', () => {
        this.releaseMicrophone()
        this.talking = false
        this.onStatus('offline')
      })
      peer.addEventListener('connectionstatechange', () => {
        if (
          peer.connectionState === 'failed' ||
          peer.connectionState === 'disconnected'
        ) {
          this.releaseMicrophone()
          this.talking = false
          this.onStatus(
            'error',
            'Realtime connection lost. Your story progress is safe.',
          )
        }
      })

      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      const response = await fetch('/api/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      })
      if (!response.ok) {
        const detail = await readError(response)
        throw new Error(detail ?? 'Could not create the live voice session.')
      }
      await peer.setRemoteDescription({
        type: 'answer',
        sdp: await response.text(),
      })
    } catch (cause) {
      this.close()
      throw cause
    }
  }

  pushToTalk(active: boolean) {
    if (!active) this.releaseMicrophone()
    if (!this.channel || this.channel.readyState !== 'open' || !this.microphone)
      return
    if (active) {
      if (this.talking) return
      this.send({ type: 'response.cancel' })
      this.send({ type: 'output_audio_buffer.clear' })
      this.send({ type: 'input_audio_buffer.clear' })
      this.microphone.enabled = true
      this.talking = true
      this.onStatus('listening')
      return
    }
    if (!this.talking) return
    this.talking = false
    this.send({ type: 'input_audio_buffer.commit' })
    this.send({ type: 'response.create' })
    this.onStatus('ready')
  }

  announceState(state: LanternState, message: string) {
    this.sendText(`${message}\nUpdated durable state: ${JSON.stringify(state)}`)
  }

  close() {
    this.releaseMicrophone()
    this.talking = false
    this.microphone?.stop()
    this.channel?.close()
    this.peer?.close()
    this.remoteAudio?.remove()
    this.microphone = undefined
    this.channel = undefined
    this.peer = undefined
    this.remoteAudio = undefined
    this.commandTimes.clear()
  }

  private sendText(text: string) {
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    })
    this.send({ type: 'response.create' })
  }

  private send(event: unknown) {
    if (this.channel?.readyState === 'open')
      this.channel.send(JSON.stringify(event))
  }

  private releaseMicrophone() {
    if (this.microphone) this.microphone.enabled = false
  }

  private async receiveEvent(raw: unknown) {
    try {
      if (typeof raw !== 'string') throw new Error('Unexpected Realtime event.')
      await this.handleEvent(JSON.parse(raw) as RealtimeEvent)
    } catch (cause) {
      this.onStatus('error', message(cause))
    }
  }

  private commandAt(id: string) {
    const existing = this.commandTimes.get(id)
    if (existing) return existing
    const initiatedAt = new Date().toISOString()
    this.commandTimes.set(id, initiatedAt)
    return initiatedAt
  }

  private async handleEvent(event: RealtimeEvent) {
    if (event.type === 'error') {
      this.onStatus('error', event.error?.message ?? 'Realtime error')
      return
    }
    if (
      event.type === 'response.output_audio_transcript.done' &&
      event.transcript
    ) {
      await this.recordSpeech(
        event.event_id ?? crypto.randomUUID(),
        'dungeon-master',
        event.transcript,
      )
    }
    if (
      event.type === 'conversation.item.input_audio_transcription.completed' &&
      event.transcript
    ) {
      await this.recordSpeech(
        event.item_id ?? event.event_id ?? crypto.randomUUID(),
        'player',
        event.transcript,
      )
    }
    if (event.type !== 'response.done') return
    const calls = event.response?.output?.filter(isFunctionCall) ?? []
    for (const call of calls) await this.handleToolCall(call)
  }

  private async recordSpeech(
    id: string,
    role: 'player' | 'dungeon-master',
    text: string,
  ) {
    const state = await lanternCommand(
      '/api/lantern/speech',
      { utteranceId: id, role, text },
      id,
      this.commandAt(id),
    )
    this.onState(state)
  }

  private async handleToolCall(call: FunctionCall) {
    let output: Record<string, unknown>
    try {
      const args = JSON.parse(call.arguments) as Record<string, unknown>
      if (call.name === 'report_physical_roll') {
        const faces = Array.isArray(args.faces)
          ? args.faces.filter((face): face is number => Number.isInteger(face))
          : []
        this.onRollCandidate(faces)
        output = { awaiting_player_confirmation: true, heard_faces: faces }
      } else {
        const path =
          call.name === 'set_hero_name'
            ? '/api/lantern/name'
            : call.name === 'approach_ember_spirit'
              ? '/api/lantern/approach'
              : call.name === 'choose_ember_fate'
                ? '/api/lantern/fate'
                : null
        if (!path) throw new Error(`Unknown Last Lantern tool: ${call.name}`)
        const state = await lanternCommand(
          path,
          args,
          call.call_id,
          this.commandAt(call.call_id),
        )
        this.onState(state)
        output = { ok: true, durable_state: state }
      }
    } catch (cause) {
      output = {
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      }
    }
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(output),
      },
    })
    this.send({ type: 'response.create' })
  }
}

type FunctionCall = {
  type: 'function_call'
  name: string
  call_id: string
  arguments: string
}
function isFunctionCall(
  value: FunctionCall | { type: string },
): value is FunctionCall {
  return (
    value.type === 'function_call' &&
    'name' in value &&
    'call_id' in value &&
    'arguments' in value
  )
}
type RealtimeEvent = {
  type: string
  event_id?: string
  item_id?: string
  transcript?: string
  error?: { message?: string }
  response?: { output?: Array<FunctionCall | { type: string }> }
}

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string }
    return payload.error
  } catch {
    return undefined
  }
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}
