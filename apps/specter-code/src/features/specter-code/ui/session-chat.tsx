import { useServerFn } from '@tanstack/solid-start'
import {
  For,
  Show,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  on,
  startTransition,
  useContext,
} from 'solid-js'

import {
  createSpecterCodeSession,
  getSpecterCodeSettings,
  listSpecterCodeSessionTranscript,
  listSpecterCodeSessions,
  submitSpecterCodePrompt,
} from '../server-functions'
import { createPollingResource } from '../../../lib/create-polling-resource'
import { useSpecterCodeSelection } from './selection-context'
import { useWorkspaces } from './workspaces'
import { useFilesystem } from './filesystem'
import { useRuns } from './runs'
import {
  Icon,
  POLL_INTERVAL_MS,
  SPECTER_CODE_USER_DISPLAY_NAME,
  formatCount,
  initials,
  shortId,
  type ProviderProps,
} from './shared/view-helpers'

function createSessionChatModel() {
  const [sessionDraft, setSessionDraft] = createSignal('')
  const [promptDraft, setPromptDraft] = createSignal('')
  const [isCreatingSession, setIsCreatingSession] = createSignal(false)
  const [isSubmittingPrompt, setIsSubmittingPrompt] = createSignal(false)
  const { activeWorkspaceId, activeSessionId, setActiveSessionId } =
    useSpecterCodeSelection()

  const createSessionFn = useServerFn(createSpecterCodeSession)
  const getSettingsFn = useServerFn(getSpecterCodeSettings)
  const listSessionsFn = useServerFn(listSpecterCodeSessions)
  const submitPromptFn = useServerFn(submitSpecterCodePrompt)
  const listTranscriptFn = useServerFn(listSpecterCodeSessionTranscript)

  const [sessions, { refetch: refetchSessions }] = createPollingResource(
    () => activeWorkspaceId(),
    (workspaceId) => listSessionsFn({ data: { workspaceId } }),
    { intervalMs: POLL_INTERVAL_MS, initialValue: [] },
  )

  createEffect(
    on(sessions, (items) => {
      if (!items?.length) {
        if (activeSessionId())
          void startTransition(() => setActiveSessionId(null))
        return
      }
      if (
        !activeSessionId() ||
        !items.some((item) => item.id === activeSessionId())
      ) {
        void startTransition(() => setActiveSessionId(items[0].id))
      }
    }),
  )

  const [transcript, { refetch: refetchTranscript }] = createPollingResource(
    () => activeSessionId(),
    (sessionId) => listTranscriptFn({ data: { sessionId } }),
    { intervalMs: POLL_INTERVAL_MS, initialValue: [] },
  )

  const sessionList = createMemo(() => sessions() ?? [])
  const activeSession = createMemo(() =>
    sessionList().find((session) => session.id === activeSessionId()),
  )
  const visibleTranscript = createMemo(
    () => transcript()?.filter(Boolean) ?? [],
  )

  async function createSession(event: SubmitEvent) {
    event.preventDefault()
    const title = sessionDraft().trim()
    const workspaceId = activeWorkspaceId()
    if (!title || !workspaceId || isCreatingSession()) return
    setIsCreatingSession(true)
    try {
      const settings = await getSettingsFn()
      const model = settings.defaultModel ?? {
        providerId: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4',
      }
      await createSessionFn({
        data: {
          workspaceId,
          title,
          directory: '.',
          agent: settings.defaultAgent?.id ?? 'build',
          model: {
            providerId: model.providerId,
            modelId: model.modelId,
          },
          createdBy: { displayName: SPECTER_CODE_USER_DISPLAY_NAME },
        },
      })
      setSessionDraft('')
      const refreshed = await listSessionsFn({ data: { workspaceId } })
      await refetchSessions()
      const newest = refreshed.at(-1)
      if (newest) void startTransition(() => setActiveSessionId(newest.id))
    } finally {
      setIsCreatingSession(false)
    }
  }

  async function submitPrompt(event: SubmitEvent) {
    event.preventDefault()
    const content = promptDraft().trim()
    const sessionId = activeSessionId()
    const workspaceId = activeWorkspaceId()
    if (!content || !sessionId || !workspaceId || isSubmittingPrompt()) return
    setIsSubmittingPrompt(true)
    try {
      await submitPromptFn({
        data: {
          sessionId,
          workspaceId,
          content,
          agentId: activeSession()?.agent ?? 'build',
          agentName: activeSession()?.agent ?? 'Build Agent',
          submittedBy: { displayName: SPECTER_CODE_USER_DISPLAY_NAME },
        },
      })
      setPromptDraft('')
      await refetchTranscript()
    } finally {
      setIsSubmittingPrompt(false)
    }
  }

  return {
    sessionDraft,
    setSessionDraft,
    promptDraft,
    setPromptDraft,
    isCreatingSession,
    isSubmittingPrompt,
    sessions,
    refetchSessions,
    transcript,
    refetchTranscript,
    sessionList,
    activeSession,
    visibleTranscript,
    createSession,
    submitPrompt,
  }
}

type SessionChatContextValue = ReturnType<typeof createSessionChatModel>
const SessionChatContext = createContext<SessionChatContextValue>()

export function SessionChatProvider(props: ProviderProps) {
  const value = createSessionChatModel()
  return (
    <SessionChatContext.Provider value={value}>
      {props.children}
    </SessionChatContext.Provider>
  )
}

export function useSessionChat() {
  const value = useContext(SessionChatContext)
  if (!value)
    throw new Error('useSessionChat must be used inside SessionChatProvider')
  return value
}

export function SessionChatPanel() {
  const { activeWorkspaceId, activeSessionId, setActiveSessionId } =
    useSpecterCodeSelection()
  const workspaces = useWorkspaces()
  const sessions = useSessionChat()
  const filesystem = useFilesystem()
  const runs = useRuns()

  return (
    <section class="order-3 flex min-h-[28rem] flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#07101c]/82 shadow-2xl shadow-black/35 ring-1 ring-white/5 backdrop-blur-xl sm:min-h-[34rem] xl:order-none xl:col-start-2 xl:row-start-2 xl:min-h-0">
      <header class="border-b border-white/10 p-4">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div class="min-w-0">
            <p class="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.28em] text-cyan-200/80">
              Active Workspace
            </p>
            <h2
              id="thread-heading"
              class="mt-1 truncate text-2xl font-semibold tracking-tight text-white sm:text-3xl"
            >
              {workspaces.activeWorkspaceName()}
            </h2>
            <p class="mt-2 text-sm leading-6 text-slate-400">
              <Show
                when={activeWorkspaceId()}
                fallback="Create or select a workspace to start the reference flow."
              >
                {formatCount(sessions.sessionList().length, 'session')} ·{' '}
                {formatCount(sessions.visibleTranscript().length, 'message')} in
                the active transcript.
              </Show>
            </p>
          </div>
          <div class="grid grid-cols-3 gap-2 text-xs lg:w-[22rem]">
            <div class="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <div class="font-mono uppercase tracking-[0.18em] text-slate-500">
                Sessions
              </div>
              <div class="mt-1 font-semibold text-white">
                {sessions.sessionList().length}
              </div>
            </div>
            <div class="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <div class="font-mono uppercase tracking-[0.18em] text-slate-500">
                Files
              </div>
              <div class="mt-1 font-semibold text-white">
                {filesystem.visibleFiles()}
              </div>
            </div>
            <div class="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <div class="font-mono uppercase tracking-[0.18em] text-slate-500">
                Runs
              </div>
              <div class="mt-1 font-semibold text-white">
                {runs.runList().length}
              </div>
            </div>
          </div>
        </div>
        <div class="mt-4 rounded-3xl border border-violet-300/15 bg-violet-300/[0.04] p-3">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div class="min-w-0">
              <p class="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.24em] text-violet-200/80">
                OpenCode Sessions
              </p>
              <p class="mt-1 text-xs text-slate-500">
                {sessions.activeSession()
                  ? `${sessions.activeSession()!.agent} · ${sessions.activeSession()!.model.modelId}`
                  : formatCount(sessions.sessionList().length, 'session')}
              </p>
            </div>
            <form
              onSubmit={sessions.createSession}
              class="flex min-w-0 gap-2 lg:w-[28rem]"
            >
              <input
                class="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-violet-300/70"
                value={sessions.sessionDraft()}
                onInput={(event) =>
                  sessions.setSessionDraft(event.currentTarget.value)
                }
                placeholder="New session title"
                disabled={!activeWorkspaceId() || sessions.isCreatingSession()}
              />
              <button
                type="submit"
                class="rounded-2xl bg-violet-300 px-3 py-2 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  !activeWorkspaceId() ||
                  !sessions.sessionDraft().trim() ||
                  sessions.isCreatingSession()
                }
              >
                Create
              </button>
            </form>
          </div>
          <div class="mt-3 flex gap-2 overflow-x-auto pb-1">
            <For each={sessions.sessionList()}>
              {(session) => (
                <button
                  type="button"
                  class={`shrink-0 rounded-2xl border px-3 py-2 text-left text-xs transition ${session.id === activeSessionId() ? 'border-violet-300/50 bg-violet-300/15 text-white' : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-violet-300/30'}`}
                  onClick={() => setActiveSessionId(session.id)}
                >
                  <span class="block max-w-48 truncate font-semibold">
                    {session.title}
                  </span>
                  <span class="mt-0.5 block font-mono text-[0.62rem] text-slate-500">
                    {shortId(session.id)} · {session.agent}
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>
      </header>

      <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
        <Show
          when={activeWorkspaceId()}
          fallback={
            <div class="grid h-full min-h-80 place-items-center rounded-3xl border border-dashed border-cyan-100/15 bg-white/[0.025] p-8 text-center">
              <div>
                <div class="mx-auto grid h-14 w-14 place-items-center rounded-3xl border border-cyan-300/20 bg-cyan-300/10 text-2xl text-cyan-100">
                  <Icon name="workspace" />
                </div>
                <h3 class="mt-4 text-lg font-semibold text-white">
                  No workspace selected
                </h3>
                <p class="mt-2 max-w-md text-sm leading-6 text-slate-400">
                  Workspaces anchor chat posts, filesystem scans, file previews,
                  and agent run history.
                </p>
              </div>
            </div>
          }
        >
          <Show
            when={sessions.activeSession()}
            fallback={
              <div
                role="log"
                aria-label="Session transcript"
                class="grid min-h-80 place-items-center rounded-3xl border border-dashed border-cyan-100/15 bg-white/[0.025] p-8 text-center"
              >
                <div>
                  <div class="mx-auto grid h-14 w-14 place-items-center rounded-3xl border border-white/10 bg-slate-900 text-2xl text-slate-300">
                    <Icon name="chat" />
                  </div>
                  <h3 class="mt-4 text-lg font-semibold text-white">
                    Create a coding session
                  </h3>
                  <p class="mt-2 max-w-md text-sm leading-6 text-slate-400">
                    Sessions are the primary OpenCode-style chat surface. Create
                    one, submit a prompt, and replies will appear in this
                    transcript.
                  </p>
                </div>
              </div>
            }
          >
            <div
              role="log"
              aria-label="Session transcript"
              class="flex min-h-80 flex-col gap-3"
            >
              <Show
                when={
                  !(
                    sessions.transcript.loading &&
                    sessions.visibleTranscript().length === 0
                  )
                }
                fallback={
                  <div class="space-y-3">
                    <div class="h-24 w-2/3 animate-pulse rounded-3xl bg-white/5" />
                    <div class="ml-auto h-20 w-1/2 animate-pulse rounded-3xl bg-white/10" />
                  </div>
                }
              >
                <Show
                  when={sessions.visibleTranscript().length > 0}
                  fallback={
                    <div class="grid min-h-80 place-items-center rounded-3xl border border-dashed border-cyan-100/15 bg-white/[0.025] p-8 text-center">
                      <div>
                        <div class="mx-auto grid h-14 w-14 place-items-center rounded-3xl border border-cyan-300/20 bg-cyan-300/10 text-2xl text-cyan-100">
                          <Icon name="terminal" />
                        </div>
                        <h3 class="mt-4 text-lg font-semibold text-white">
                          Prompt this session
                        </h3>
                        <p class="mt-2 max-w-md text-sm leading-6 text-slate-400">
                          Use the prompt box below to start a durable session
                          transcript backed by Specter events.
                        </p>
                      </div>
                    </div>
                  }
                >
                  <For each={sessions.visibleTranscript()}>
                    {(message) => {
                      const isAssistant = () => message.role === 'assistant'
                      return (
                        <article
                          class={`group flex max-w-full gap-3 sm:max-w-[min(52rem,94%)] ${isAssistant() ? '' : 'ml-auto flex-row-reverse'}`}
                        >
                          <div
                            class={`mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-2xl text-xs font-bold shadow-lg ${isAssistant() ? 'bg-cyan-300 text-slate-950 shadow-cyan-950/30' : 'bg-slate-100 text-slate-950 shadow-black/20'}`}
                          >
                            {isAssistant() ? (
                              <Icon name="bot" />
                            ) : (
                              initials(message.author.displayName)
                            )}
                          </div>
                          <div
                            class={`rounded-3xl border px-4 py-3 shadow-lg ${isAssistant() ? 'border-cyan-300/20 bg-cyan-300/10 text-cyan-50 shadow-cyan-950/20' : 'border-white/20 bg-slate-100 text-slate-950 shadow-black/20'}`}
                          >
                            <div class="mb-1 flex flex-wrap items-center gap-2 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.18em] opacity-70">
                              <span>{message.author.displayName}</span>
                              <span class="rounded-full bg-current/10 px-2 py-0.5">
                                {message.role}
                              </span>
                            </div>
                            <p class="whitespace-pre-wrap break-words text-sm leading-6">
                              {message.content}
                            </p>
                          </div>
                        </article>
                      )
                    }}
                  </For>
                </Show>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </section>
  )
}

export function SessionPromptComposer() {
  const { activeSessionId } = useSpecterCodeSelection()
  const sessions = useSessionChat()

  return (
    <form
      onSubmit={sessions.submitPrompt}
      class="order-4 rounded-[1.75rem] border border-white/10 bg-[#07101c]/90 p-2.5 shadow-2xl shadow-black/35 ring-1 ring-white/5 backdrop-blur-xl transition focus-within:border-cyan-300/50 focus-within:ring-cyan-300/10 xl:order-none xl:col-start-2 xl:row-start-3"
    >
      <div class="flex items-center justify-between gap-3 px-2">
        <label
          for="specterCode-session-prompt"
          class="flex items-center gap-2 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-slate-500"
        >
          <Icon name="terminal" class="text-cyan-200" />
          Session Prompt
        </label>
        <span class="hidden text-xs text-slate-500 sm:inline">
          Ctrl/⌘ + Enter sends to the active session
        </span>
      </div>
      <div class="mt-2 flex items-end gap-2 rounded-2xl border border-white/10 bg-black/25 px-2 py-2 shadow-inner shadow-black/20">
        <span class="mb-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 font-mono text-cyan-100">
          <Icon name="terminal" />
        </span>
        <textarea
          id="specterCode-session-prompt"
          class="min-h-12 min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm leading-6 text-white outline-none placeholder:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
          value={sessions.promptDraft()}
          onInput={(event) =>
            sessions.setPromptDraft(event.currentTarget.value)
          }
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          placeholder="Prompt this session"
          disabled={!activeSessionId() || sessions.isSubmittingPrompt()}
        />
        <button
          type="submit"
          aria-label="Send"
          title={sessions.isSubmittingPrompt() ? 'Sending...' : 'Send'}
          class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan-300 text-lg font-semibold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={
            !activeSessionId() ||
            !sessions.promptDraft().trim() ||
            sessions.isSubmittingPrompt()
          }
        >
          <Icon
            name={sessions.isSubmittingPrompt() ? 'refresh' : 'send'}
            class={sessions.isSubmittingPrompt() ? 'animate-spin' : ''}
          />
        </button>
      </div>
    </form>
  )
}
