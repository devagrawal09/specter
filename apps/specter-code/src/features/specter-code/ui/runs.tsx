import { useServerFn } from '@tanstack/solid-start'
import { For, Show, createContext, createEffect, createMemo, createSignal, on, startTransition, useContext } from 'solid-js'

import {
  createSpecterCodePost,
  listSpecterCodeAgentRunTimeline,
  listSpecterCodeWorkspaceAgentRuns,
  listSpecterCodeWorkspaceChat,
  requestSpecterCodeAgentRun,
} from '../server-functions'
import { createPollingResource } from '../../../lib/create-polling-resource'
import { useSpecterCodeSelection } from './selection-context'
import {
  Icon,
  POLL_INTERVAL_MS,
  SPECTER_CODE_USER_DISPLAY_NAME,
  formatCount,
  runStatusTone,
  shortId,
  wait,
  type ProviderProps,
} from './shared/view-helpers'

function createRunsModel() {
  const [isRequestingRun, setIsRequestingRun] = createSignal(false)
  const { activeWorkspaceId, activeRunId, setActiveRunId } = useSpecterCodeSelection()

  const listChatFn = useServerFn(listSpecterCodeWorkspaceChat)
  const createPostFn = useServerFn(createSpecterCodePost)
  const requestRunFn = useServerFn(requestSpecterCodeAgentRun)
  const listRunsFn = useServerFn(listSpecterCodeWorkspaceAgentRuns)
  const listTimelineFn = useServerFn(listSpecterCodeAgentRunTimeline)

  const [runs, { refetch: refetchRuns }] = createPollingResource(
    () => activeWorkspaceId(),
    (workspaceId) => listRunsFn({ data: { workspaceId } }),
    { intervalMs: POLL_INTERVAL_MS, initialValue: [] },
  )

  createEffect(
    on(runs, (items) => {
      const latest = items?.at(-1)
      if (!latest) {
        if (activeRunId()) void startTransition(() => setActiveRunId(null))
        return
      }
      if (!activeRunId() || !items?.some((item) => item.runId === activeRunId())) {
        void startTransition(() => setActiveRunId(latest.runId))
      }
    }),
  )

  const [timeline, { refetch: refetchTimeline }] = createPollingResource(
    () => {
      const workspaceId = activeWorkspaceId()
      const runId = activeRunId()
      if (!workspaceId || !runId) return null
      return { workspaceId, runId }
    },
    (source) => listTimelineFn({ data: source }),
    { intervalMs: POLL_INTERVAL_MS, initialValue: { chunks: [], toolCalls: [] } },
  )

  const runList = createMemo(() => runs() ?? [])
  const activeRun = createMemo(() => runList().find((run) => run.runId === activeRunId()))
  const currentTimeline = createMemo(() => timeline() ?? { chunks: [], toolCalls: [] })
  const latestToolCall = createMemo(() => currentTimeline().toolCalls.at(-1))
  const toolCallCount = createMemo(() => currentTimeline().toolCalls.length)
  const timelineTranscript = createMemo(() =>
    [...currentTimeline().chunks]
      .sort((left, right) => left.sequence - right.sequence)
      .map((chunk) => chunk.delta)
      .join(''),
  )

  async function findLatestPostIdByContent(workspaceId: string, content: string) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const latestChat = await listChatFn({ data: { workspaceId } })
      const post = [...(latestChat ?? [])]
        .reverse()
        .find((item) => item.content === content && item.author.displayName === 'SpecterCode Demo')

      if (post) return post.id
      await wait(50)
    }

    return undefined
  }

  async function simulateAgentRun() {
    const workspaceId = activeWorkspaceId()
    if (!workspaceId || isRequestingRun()) return
    setIsRequestingRun(true)
    const requestContent = 'Simulated agent request'
    try {
      await createPostFn({
        data: {
          workspaceId,
          author: { displayName: 'SpecterCode Demo' },
          content: requestContent,
        },
      })
      const postId = await findLatestPostIdByContent(workspaceId, requestContent)
      await requestRunFn({
        data: {
          workspaceId,
          postId,
          agentId: 'simulated-agent',
          agentName: 'Simulated Agent',
          requestedBy: {
            type: 'user',
            displayName: SPECTER_CODE_USER_DISPLAY_NAME,
          },
        },
      })
      const refreshedRuns = await listRunsFn({ data: { workspaceId } })
      await refetchRuns()
      const nextRun = refreshedRuns.at(-1)
      if (nextRun) void startTransition(() => setActiveRunId(nextRun.runId))
      if (nextRun) await refetchTimeline()
    } finally {
      setIsRequestingRun(false)
    }
  }

  return {
    isRequestingRun,
    runs,
    refetchRuns,
    timeline,
    refetchTimeline,
    runList,
    activeRun,
    currentTimeline,
    latestToolCall,
    toolCallCount,
    timelineTranscript,
    simulateAgentRun,
  }
}

type RunsContextValue = ReturnType<typeof createRunsModel>
const RunsContext = createContext<RunsContextValue>()

export function RunsProvider(props: ProviderProps) {
  const value = createRunsModel()
  return <RunsContext.Provider value={value}>{props.children}</RunsContext.Provider>
}

export function useRuns() {
  const value = useContext(RunsContext)
  if (!value) throw new Error('useRuns must be used inside RunsProvider')
  return value
}

export function AgentRunsPanel() {
  const { activeRunId, setActiveRunId } = useSpecterCodeSelection()
  const runs = useRuns()

  return (
    <section class="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-cyan-100/10 bg-slate-950/45 p-2.5 shadow-inner shadow-black/20">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h3 class="flex items-center gap-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-slate-300">
            <Icon name="bot" class="text-cyan-200" />
            Runs
          </h3>
        </div>
        <span class={`shrink-0 rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold ${runStatusTone(runs.activeRun()?.status)}`}>
          {runs.activeRun()?.status ?? 'none'}
        </span>
      </div>

      <div class="mt-1.5 min-h-0 flex-1 overflow-y-auto pr-1">
        <Show
          when={runs.runList().length > 0}
          fallback={<div class="rounded-xl border border-dashed border-cyan-100/15 p-2.5 text-xs leading-5 text-slate-400">No runs yet. Press play after selecting a workspace.</div>}
        >
          <div class="space-y-1.5">
            <For each={[...runs.runList()].reverse()}>
              {(run) => {
                const isActive = () => run.runId === activeRunId()
                return (
                  <button
                    type="button"
                    aria-label={`${run.agentName ?? 'Agent'} · ${run.status ?? 'unknown'}`}
                    class={`w-full rounded-xl border px-2.5 py-1.5 text-left transition ${isActive() ? 'border-cyan-300/60 bg-cyan-300/15' : 'border-white/10 bg-slate-950/55 hover:border-white/20 hover:bg-slate-900/70'}`}
                    onClick={() => setActiveRunId(run.runId)}
                  >
                    <div class="flex items-center justify-between gap-2">
                      <div class="min-w-0">
                        <div class="truncate text-xs font-semibold text-white">
                          {run.agentName ?? 'Agent'} · {run.status ?? 'unknown'}
                        </div>
                        <div class="truncate font-mono text-[0.62rem] text-slate-500">
                          {shortId(run.runId)} · {formatCount(runs.runList().length, 'run')}
                        </div>
                      </div>
                      <span class={`shrink-0 rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold ${runStatusTone(run.status)}`}>
                        {run.status ?? 'unknown'}
                      </span>
                    </div>
                    <Show when={run.error}>
                      <div class="mt-1.5 rounded-lg border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-[0.68rem] text-rose-100">
                        {run.error}
                      </div>
                    </Show>
                  </button>
                )
              }}
            </For>
          </div>
        </Show>
      </div>
    </section>
  )
}

export function AgentTimelinePanel() {
  const runs = useRuns()

  return (
    <section class="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-emerald-100/10 bg-slate-950/45 p-2.5 shadow-inner shadow-black/20">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h3 class="flex items-center gap-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-slate-300">
            <Icon name="activity" class="text-emerald-200" />
            Timeline
          </h3>
          <p class="mt-0.5 truncate text-[0.68rem] text-slate-500">
            {runs.latestToolCall() ? `${runs.latestToolCall()?.toolName} · ${runs.latestToolCall()?.status}` : 'Stream + tool calls'}
          </p>
        </div>
        <Show
          when={runs.timeline.loading}
          fallback={<span class="rounded-full border border-white/10 bg-black/25 px-2 py-0.5 text-[0.68rem] font-semibold text-slate-400">{runs.toolCallCount()} tools</span>}
        >
          <span class="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[0.68rem] font-semibold text-cyan-100">Refreshing</span>
        </Show>
      </div>

      <div class="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
        <Show
          when={runs.activeRun()}
          fallback={<div class="rounded-xl border border-dashed border-emerald-100/15 p-3 text-xs leading-5 text-slate-400">Select or simulate a run to inspect timeline activity.</div>}
        >
          <div class="space-y-2">
            <div>
              <div class="mb-1 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-slate-500">Tool calls</div>
              <Show
                when={runs.currentTimeline().toolCalls.length > 0}
                fallback={<div class="rounded-xl border border-dashed border-cyan-100/15 p-2.5 text-xs leading-5 text-slate-400">No tool calls recorded for this run.</div>}
              >
                <div class="space-y-1.5">
                  <For each={[...runs.currentTimeline().toolCalls].reverse()}>
                    {(toolCall) => (
                      <div class="rounded-xl border border-white/10 bg-slate-950/55 px-2.5 py-1.5">
                        <div class="flex items-center justify-between gap-2">
                          <div class="truncate text-xs font-semibold text-white">{toolCall.toolName}</div>
                          <span class={`shrink-0 rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold ${runStatusTone(toolCall.status)}`}>{toolCall.status}</span>
                        </div>
                        <Show when={toolCall.inputSummary}><p class="mt-0.5 truncate text-[0.68rem] text-slate-500">{toolCall.inputSummary}</p></Show>
                        <Show when={'outputSummary' in toolCall && toolCall.outputSummary}><p class="mt-0.5 truncate text-[0.68rem] text-emerald-200/80">{'outputSummary' in toolCall ? toolCall.outputSummary : ''}</p></Show>
                        <Show when={'error' in toolCall && toolCall.error}><p class="mt-0.5 truncate text-[0.68rem] text-rose-200/80">{'error' in toolCall ? toolCall.error : ''}</p></Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            <Show
              when={runs.timelineTranscript().length > 0}
              fallback={<div class="rounded-xl border border-dashed border-cyan-100/15 p-2.5 text-xs leading-5 text-slate-400">No streamed text chunks yet.</div>}
            >
              <div class="max-h-16 overflow-y-auto rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-2.5 text-xs leading-5 text-cyan-50">
                <div class="mb-1 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">Stream</div>
                {runs.timelineTranscript()}
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </section>
  )
}
