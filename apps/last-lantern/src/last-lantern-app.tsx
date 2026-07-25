import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js'
import {
  pulseController,
  watchController,
  type ControllerSnapshot,
} from './controller'
import {
  getLanternState,
  lanternCommand,
  type LanternState,
} from './lantern-api'
import { LanternRealtimeClient } from './realtime-client'

const emptyState: LanternState = {
  stage: 'not-started',
  heroName: null,
  approach: null,
  pendingRoll: null,
  lastOutcome: null,
  ending: null,
  rollsConfirmed: 0,
  checkpointRecovered: false,
  transcript: [],
}

export function LastLanternApp() {
  const [state, setState] = createSignal<LanternState>(emptyState)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [mode, setMode] = createSignal<'live' | 'demo' | null>(null)
  const [voiceStatus, setVoiceStatus] = createSignal('offline')
  const [voiceDetail, setVoiceDetail] = createSignal<string | null>(null)
  const [controller, setController] = createSignal<ControllerSnapshot>({
    connected: false,
    label: 'No controller',
    pushToTalk: false,
  })
  const [candidate, setCandidate] = createSignal<number[] | null>(null)
  const [focused, setFocused] = createSignal(0)
  let realtime: LanternRealtimeClient | undefined

  const refreshFocus = () => {
    const controls = controllerControls()
    controls.forEach((control, index) => {
      control.classList.toggle('controller-focus', index === focused())
    })
  }
  const moveFocus = (direction: -1 | 1) => {
    const controls = controllerControls()
    if (!controls.length) return
    setFocused((focused() + direction + controls.length) % controls.length)
    refreshFocus()
    void pulseController(45, 0.12)
  }
  const confirmFocus = () => controllerControls()[focused()]?.click()
  const controllerBack = () => {
    if (candidate()) setCandidate(null)
  }
  const pushToTalk = (active: boolean) => {
    realtime?.pushToTalk(active)
    if (mode() === 'demo') setVoiceStatus(active ? 'listening' : 'ready')
  }
  const releasePushToTalk = () => pushToTalk(false)

  queueMicrotask(async () => {
    try {
      const durable = await getLanternState()
      setState(durable)
      const savedMode = localStorage.getItem('last-lantern-mode')
      if (savedMode === 'live' || savedMode === 'demo') {
        setMode(savedMode)
        if (savedMode === 'demo') setVoiceStatus('ready')
      }
      if (
        sessionStorage.getItem('last-lantern-reload') === 'pending' &&
        durable.stage === 'reload-checkpoint'
      ) {
        sessionStorage.removeItem('last-lantern-reload')
        setState(await lanternCommand('/api/lantern/checkpoint/recovered'))
        void pulseController(320, 0.45)
      }
    } catch (cause) {
      setError(message(cause))
    } finally {
      setLoading(false)
    }

    const stopController = watchController({
      onChange: setController,
      onConfirm: confirmFocus,
      onBack: controllerBack,
      onNavigate: moveFocus,
      onPushToTalk: pushToTalk,
    })
    const keyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !event.repeat && !isTyping()) {
        event.preventDefault()
        pushToTalk(true)
      }
      if (event.code === 'ArrowDown' && !isTyping()) moveFocus(1)
      if (event.code === 'ArrowUp' && !isTyping()) moveFocus(-1)
      if (event.code === 'Enter' && !isTyping()) confirmFocus()
    }
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isTyping()) pushToTalk(false)
    }
    const pageHidden = () => {
      if (document.visibilityState === 'hidden') releasePushToTalk()
    }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', releasePushToTalk)
    window.addEventListener('pagehide', releasePushToTalk)
    document.addEventListener('visibilitychange', pageHidden)
    cleanup = () => {
      releasePushToTalk()
      stopController()
      realtime?.close()
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', releasePushToTalk)
      window.removeEventListener('pagehide', releasePushToTalk)
      document.removeEventListener('visibilitychange', pageHidden)
    }
  })

  let cleanup = () => undefined
  onCleanup(() => cleanup())

  createEffect(
    () => [state().stage, candidate()] as const,
    () => {
      queueMicrotask(() => {
        setFocused(0)
        refreshFocus()
        if (mode() === 'demo') speakDemo(stageNarration(state()))
      })
    },
  )

  async function begin(selectedMode: 'live' | 'demo') {
    setError(null)
    try {
      localStorage.setItem('last-lantern-mode', selectedMode)
      setMode(selectedMode)
      const next =
        state().stage === 'not-started'
          ? await lanternCommand('/api/lantern/start')
          : state()
      setState(next)
      if (selectedMode === 'live') await connectVoice(next)
      else setVoiceStatus('ready')
      void pulseController(180, 0.25)
    } catch (cause) {
      setError(message(cause))
      if (selectedMode === 'live') {
        setVoiceStatus('error')
        setVoiceDetail(
          'Live voice did not connect. Retry it or continue in Demo Mode.',
        )
      }
    }
  }

  async function connectVoice(current = state()) {
    realtime?.close()
    realtime = new LanternRealtimeClient({
      onStatus: (status, detail) => {
        setVoiceStatus(status)
        setVoiceDetail(detail ?? null)
      },
      onState: setState,
      onRollCandidate: (faces) => {
        setCandidate(faces)
        void pulseController(220, 0.35)
      },
    })
    await realtime.connect(current)
  }

  async function retryVoice() {
    setError(null)
    setVoiceDetail(null)
    try {
      await connectVoice()
    } catch (cause) {
      setVoiceStatus('error')
      setVoiceDetail(
        `${message(cause)} Your story progress is safe. Retry or use Demo Mode.`,
      )
    }
  }

  function switchToDemo() {
    releasePushToTalk()
    realtime?.close()
    realtime = undefined
    localStorage.setItem('last-lantern-mode', 'demo')
    setMode('demo')
    setVoiceStatus('ready')
    setVoiceDetail(null)
    setError(null)
    speakDemo(stageNarration(state()))
  }

  async function command(path: string, body: unknown = {}) {
    setError(null)
    try {
      const next = await lanternCommand(path, body)
      setState(next)
      realtime?.announceState(
        next,
        'The interface committed the player action. Narrate only the returned result and continue the fixed flow.',
      )
      void pulseController(100, 0.22)
    } catch (cause) {
      setError(message(cause))
    }
  }

  async function submitName(event: SubmitEvent) {
    event.preventDefault()
    const form = new FormData(event.currentTarget as HTMLFormElement)
    await command('/api/lantern/name', { name: String(form.get('name') ?? '') })
  }

  async function confirmRoll() {
    const faces = candidate()
    const pending = state().pendingRoll
    if (!faces || !pending) return
    if (faces.length !== 1 || faces[0] < 1 || faces[0] > pending.sides) {
      setError(
        `That ${pending.sides}-sided die must show a face from 1 to ${pending.sides}.`,
      )
      return
    }
    setCandidate(null)
    await command('/api/lantern/roll/confirm', {
      rollId: pending.rollId,
      challenge: pending.challenge,
      faces,
    })
  }

  function adjustCandidate(delta: number) {
    const sides = state().pendingRoll?.sides ?? 20
    const current = candidate()?.[0] ?? 1
    setCandidate([Math.min(sides, Math.max(1, current + delta))])
  }

  function reloadCheckpoint() {
    sessionStorage.setItem('last-lantern-reload', 'pending')
    window.location.reload()
  }

  async function resetCampaign() {
    setError(null)
    try {
      realtime?.close()
      realtime = undefined
      localStorage.removeItem('last-lantern-mode')
      sessionStorage.removeItem('last-lantern-reload')
      setMode(null)
      setVoiceStatus('offline')
      setVoiceDetail(null)
      setCandidate(null)
      setState(
        await lanternCommand('/api/lantern/reset', {
          confirm: 'RESET LAST LANTERN',
        }),
      )
      void pulseController(240, 0.35)
    } catch (cause) {
      setError(message(cause))
    }
  }

  return (
    <main class={`lantern-app stage-${state().stage}`}>
      <div class="shrine-backdrop" aria-hidden="true" />
      <div class="rain" aria-hidden="true" />
      <div class="vignette" aria-hidden="true" />
      <div class="embers" aria-hidden="true">
        <For each={Array.from({ length: 22 })}>
          {(_, index) => <i style={{ '--ember': index() } as never} />}
        </For>
      </div>

      <header class="status-bar">
        <div class="brand">
          <span class="brand-rune">✦</span>
          <span>THE LAST LANTERN</span>
        </div>
        <div class="status-items">
          <span class={controller().connected ? 'status-good' : 'status-muted'}>
            <i class="status-dot" />{' '}
            {controller().connected
              ? 'Controller ready'
              : 'Press any controller button'}
          </span>
          <span class={`voice-${voiceStatus()}`}>
            <i class="status-dot" /> {voiceLabel(voiceStatus())}
          </span>
        </div>
      </header>

      <Show
        when={!loading()}
        fallback={
          <section class="center-card">
            <p>Rebuilding the shrine from its event log…</p>
          </section>
        }
      >
        <section class="story-stage">
          <Show when={state().stage === 'not-started'}>
            <div class="title-lockup">
              <p class="eyebrow">A SOLO EQUIPMENT TEST ADVENTURE</p>
              <h1>
                The Last
                <br />
                <em>Lantern</em>
              </h1>
              <p class="lede">
                One ruined shrine. One stolen flame. Eight minutes to learn
                whether the dark remembers your name.
              </p>
              <div class="action-stack">
                <button
                  data-controller
                  class="primary"
                  type="button"
                  onClick={() => void begin('live')}
                >
                  <kbd>A</kbd> Begin with live AI Dungeon Master
                </button>
                <button
                  data-controller
                  class="secondary"
                  type="button"
                  onClick={() => void begin('demo')}
                >
                  <kbd>A</kbd> Run offline Demo Mode
                </button>
              </div>
            </div>
          </Show>

          <Show when={state().stage !== 'not-started'}>
            <div class="chapter-copy">
              <p class="eyebrow">{chapterLabel(state())}</p>
              <h2>{chapterTitle(state())}</h2>
              <p>{stageNarration(state())}</p>
              <Show when={state().lastOutcome}>
                <blockquote>{state().lastOutcome}</blockquote>
              </Show>
            </div>
          </Show>

          <Show when={state().stage === 'name-hero'}>
            <form
              class="name-form"
              onSubmit={(event) => void submitName(event)}
            >
              <label for="hero-name">What name does the shrine remember?</label>
              <input
                id="hero-name"
                name="name"
                maxlength="40"
                autocomplete="off"
                autofocus
                placeholder="Type your hero’s name"
              />
              <button data-controller class="primary" type="submit">
                <kbd>A</kbd> Speak the name
              </button>
            </form>
          </Show>

          <Show when={state().stage === 'approach-spirit'}>
            <div class="choice-grid">
              <Choice
                title="Gentle"
                detail="Lower your weapon and listen."
                onChoose={() =>
                  command('/api/lantern/approach', { approach: 'gentle' })
                }
              />
              <Choice
                title="Bold"
                detail="Step between Pip and the lantern."
                onChoose={() =>
                  command('/api/lantern/approach', { approach: 'bold' })
                }
              />
              <Choice
                title="Cunning"
                detail="Pretend you already know the secret."
                onChoose={() =>
                  command('/api/lantern/approach', { approach: 'cunning' })
                }
              />
            </div>
          </Show>

          <Show
            when={
              state().stage === 'roll-runes' || state().stage === 'roll-ember'
            }
          >
            <div class="roll-seal">
              <div class="die">d{state().pendingRoll?.sides}</div>
              <div>
                <strong>
                  {state().pendingRoll?.challenge === 'read-runes'
                    ? 'Read the celestial rune'
                    : 'Catch the living ember'}
                </strong>
                <span>
                  Roll one physical d{state().pendingRoll?.sides}. Target{' '}
                  {state().pendingRoll?.target}.
                </span>
              </div>
            </div>
            <Show when={!candidate()}>
              <div class="talk-instruction">
                <span
                  class={controller().pushToTalk ? 'trigger active' : 'trigger'}
                >
                  LT
                </span>
                <p>
                  {mode() === 'live'
                    ? 'Hold the left trigger, say the face, then release.'
                    : 'Demo Mode: choose the face the voice system should have heard.'}
                </p>
              </div>
              <Show when={mode() === 'demo'}>
                <button
                  data-controller
                  class="primary"
                  type="button"
                  onClick={() =>
                    setCandidate([state().pendingRoll?.sides === 20 ? 14 : 5])
                  }
                >
                  Simulate a clear spoken result
                </button>
              </Show>
            </Show>
            <Show when={candidate()}>
              <div class="confirmation-card">
                <p>I heard</p>
                <strong>{candidate()?.join(' + ')}</strong>
                <div class="inline-actions">
                  <button
                    data-controller
                    type="button"
                    onClick={() => adjustCandidate(-1)}
                  >
                    − Correct
                  </button>
                  <button
                    data-controller
                    class="primary"
                    type="button"
                    onClick={() => void confirmRoll()}
                  >
                    <kbd>A</kbd> Confirm
                  </button>
                  <button
                    data-controller
                    type="button"
                    onClick={() => adjustCandidate(1)}
                  >
                    + Correct
                  </button>
                </div>
              </div>
            </Show>
          </Show>

          <Show when={state().stage === 'reload-checkpoint'}>
            <div class="checkpoint-card">
              <span class="checkpoint-icon">⌁</span>
              <h3>Test the shrine’s memory</h3>
              <p>
                This deliberately reloads the page. The event log must restore
                this exact moment.
              </p>
              <button
                data-controller
                class="primary"
                type="button"
                onClick={reloadCheckpoint}
              >
                <kbd>A</kbd> Save and reload checkpoint
              </button>
            </div>
          </Show>

          <Show when={state().stage === 'choose-fate'}>
            <div class="choice-grid endings">
              <Choice
                title="Free Pip"
                detail="Let the gate-flame choose its own horizon."
                onChoose={() => command('/api/lantern/fate', { fate: 'free' })}
              />
              <Choice
                title="Bind the flame"
                detail="Restore the lantern and protect every traveler."
                onChoose={() => command('/api/lantern/fate', { fate: 'bind' })}
              />
              <Choice
                title="Befriend Pip"
                detail="Carry the lantern together into the storm."
                onChoose={() =>
                  command('/api/lantern/fate', { fate: 'befriend' })
                }
              />
            </div>
          </Show>

          <Show when={state().stage === 'complete'}>
            <div class="completion">
              <div class="ending-mark">✦</div>
              <h3>{endingTitle(state().ending)}</h3>
              <p>{endingCopy(state().ending, state().heroName)}</p>
              <div class="diagnostics">
                <Diagnostic ok label="Specter story events committed" />
                <Diagnostic
                  ok={state().rollsConfirmed === 2}
                  label="Two physical rolls confirmed"
                />
                <Diagnostic
                  ok={state().checkpointRecovered}
                  label="Checkpoint replay recovered"
                />
                <Diagnostic
                  ok={controller().connected}
                  label="Controller input detected"
                />
                <Diagnostic
                  ok={voiceStatus() === 'ready' || voiceStatus() === 'speaking'}
                  label={
                    mode() === 'live'
                      ? 'Realtime voice connected'
                      : 'Demo audio path ready'
                  }
                />
              </div>
              <button
                data-controller
                class="secondary"
                type="button"
                onClick={() => void resetCampaign()}
              >
                <kbd>A</kbd> Reset and run the test again
              </button>
            </div>
          </Show>
        </section>
      </Show>

      <Show when={error() || voiceDetail()}>
        <aside class="error-toast">{error() ?? voiceDetail()}</aside>
      </Show>

      <footer class="controller-legend">
        <span>
          <kbd>LS / D-PAD</kbd> Navigate
        </span>
        <span>
          <kbd>A</kbd> Confirm
        </span>
        <span>
          <kbd>B</kbd> Back
        </span>
        <span>
          <kbd>LT</kbd> Hold to speak
        </span>
        <Show
          when={
            mode() === 'live' &&
            (voiceStatus() === 'offline' || voiceStatus() === 'error')
          }
        >
          <span class="voice-recovery">
            <button
              data-controller
              class="text-button"
              type="button"
              onClick={() => void retryVoice()}
            >
              Retry live voice
            </button>
            <button
              data-controller
              class="text-button"
              type="button"
              onClick={switchToDemo}
            >
              Switch to Demo Mode
            </button>
          </span>
        </Show>
      </footer>
    </main>
  )
}

function Choice(props: {
  title: string
  detail: string
  onChoose(): void | Promise<void>
}) {
  return (
    <button
      data-controller
      class="choice"
      type="button"
      onClick={() => void props.onChoose()}
    >
      <span class="choice-glyph">✧</span>
      <strong>{props.title}</strong>
      <small>{props.detail}</small>
    </button>
  )
}
function Diagnostic(props: { ok: boolean; label: string }) {
  return (
    <div class={props.ok ? 'diagnostic pass' : 'diagnostic pending'}>
      <span>{props.ok ? '✓' : '○'}</span>
      {props.label}
    </div>
  )
}
function controllerControls() {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      'button[data-controller]:not(:disabled)',
    ),
  ]
}
function isTyping() {
  const active = document.activeElement
  return (
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
  )
}
function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}
function voiceLabel(status: string) {
  if (status === 'connecting') return 'Calling the Dungeon Master…'
  if (status === 'ready') return 'Voice ready'
  if (status === 'listening') return 'Listening…'
  if (status === 'speaking') return 'Dungeon Master speaking'
  if (status === 'error') return 'Voice needs attention'
  return 'Voice offline'
}
function chapterLabel(state: LanternState) {
  if (state.stage === 'complete') return 'THE SHRINE REMEMBERS'
  if (state.stage === 'choose-fate') return 'THE FINAL CHOICE'
  if (state.stage === 'reload-checkpoint') return 'THE MEMORY TEST'
  return `THE LAST LANTERN · ${state.heroName ?? 'A NAME UNWRITTEN'}`
}
function chapterTitle(state: LanternState) {
  if (state.stage === 'name-hero') return 'The storm asks your name.'
  if (state.stage === 'approach-spirit') return 'A stolen flame is watching.'
  if (state.stage === 'roll-runes')
    return 'The old stars wake beneath your hand.'
  if (state.stage === 'roll-ember') return 'Pip bolts through the rain.'
  if (state.stage === 'reload-checkpoint') return 'Can the shrine remember?'
  if (state.stage === 'choose-fate')
    return 'No keeper can make this choice for you.'
  return 'The lantern burns again.'
}
function stageNarration(state: LanternState) {
  if (state.stage === 'name-hero')
    return 'Rain crosses the broken threshold. Above the final lantern, a small living flame opens two bright eyes.'
  if (state.stage === 'approach-spirit')
    return `“Careful, ${state.heroName},” the ember crackles. “They called this a sanctuary before they made it a cage.”`
  if (state.stage === 'roll-runes')
    return 'A crescent-shaped rune turns beneath the water. Its meaning waits behind a physical d20 roll.'
  if (state.stage === 'roll-ember')
    return 'The rune flashes. Pip streaks between the pillars, laughing and terrified at once.'
  if (state.stage === 'reload-checkpoint')
    return 'The lantern dims. To continue, the shrine must prove that memory survives interruption.'
  if (state.stage === 'choose-fate')
    return 'Pip hovers over the open lantern. Freedom, duty, or friendship: only one flame can leave this room.'
  if (state.stage === 'complete')
    return 'Thunder rolls away from the mountain. For the first time in centuries, the light belongs to its ending.'
  return ''
}
function endingTitle(ending: LanternState['ending']) {
  return ending === 'free'
    ? 'The Unbound Flame'
    : ending === 'bind'
      ? 'The Faithful Light'
      : 'Two Against the Dark'
}
function endingCopy(ending: LanternState['ending'], hero: string | null) {
  if (ending === 'free')
    return `${hero ?? 'The hero'} opens the stormward gate. Pip becomes a new star that wandering travelers can follow home.`
  if (ending === 'bind')
    return `${hero ?? 'The hero'} restores the lantern, but changes its oath: Pip may guard the road without ever becoming its prisoner.`
  return `${hero ?? 'The hero'} lifts the lantern. Pip settles inside by choice, and together they walk into a world with many roads left to illuminate.`
}
let lastDemoLine = ''
function speakDemo(line: string) {
  if (!line || line === lastDemoLine || !('speechSynthesis' in window)) return
  lastDemoLine = line
  speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(line)
  utterance.rate = 0.92
  utterance.pitch = 0.86
  speechSynthesis.speak(utterance)
}
