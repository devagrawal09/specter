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
    this.onStatus('connecting')
    const peer = new RTCPeerConnection()
    const audio = document.createElement('audio')
    audio.autoplay = true
    peer.ontrack = (event) => {
      audio.srcObject = event.streams[0]
      this.onStatus('speaking')
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    const track = stream.getAudioTracks()[0]
    track.enabled = false
    peer.addTrack(track, stream)
    const channel = peer.createDataChannel('oai-events')
    channel.addEventListener(
      'message',
      (event) => void this.handleEvent(JSON.parse(event.data) as RealtimeEvent),
    )
    channel.addEventListener('open', () => {
      this.onStatus('ready')
      this.sendText(
        `Begin The Last Lantern now. Current durable state: ${JSON.stringify(state)}. Continue from exactly this state.`,
      )
    })
    channel.addEventListener('close', () => this.onStatus('offline'))
    peer.addEventListener('connectionstatechange', () => {
      if (
        peer.connectionState === 'failed' ||
        peer.connectionState === 'disconnected'
      ) {
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
      const payload = (await response.json()) as { error?: string }
      throw new Error(
        payload.error ?? 'Could not create the live voice session.',
      )
    }
    await peer.setRemoteDescription({
      type: 'answer',
      sdp: await response.text(),
    })
    this.peer = peer
    this.channel = channel
    this.microphone = track
    this.remoteAudio = audio
  }

  pushToTalk(active: boolean) {
    if (!this.channel || this.channel.readyState !== 'open' || !this.microphone)
      return
    if (active) {
      this.send({ type: 'response.cancel' })
      this.send({ type: 'output_audio_buffer.clear' })
      this.send({ type: 'input_audio_buffer.clear' })
      this.microphone.enabled = true
      this.onStatus('listening')
      return
    }
    this.microphone.enabled = false
    this.send({ type: 'input_audio_buffer.commit' })
    this.send({ type: 'response.create' })
    this.onStatus('ready')
  }

  announceState(state: LanternState, message: string) {
    this.sendText(`${message}\nUpdated durable state: ${JSON.stringify(state)}`)
  }

  close() {
    this.microphone?.stop()
    this.channel?.close()
    this.peer?.close()
    this.remoteAudio?.remove()
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
    try {
      const state = await lanternCommand(
        '/api/lantern/speech',
        { utteranceId: id, role, text },
        id,
      )
      this.onState(state)
    } catch {
      // Duplicate completed transcript events are intentionally harmless.
    }
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
        const state = await lanternCommand(path, args, call.call_id)
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
