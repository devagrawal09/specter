import { createFileRoute } from '@tanstack/solid-router'
import { useServerFn } from '@tanstack/solid-start'
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  startTransition,
} from 'solid-js'

import {
  createThreadplanePost,
  createThreadplaneWorkspace,
  getThreadplaneFilesystemStatus,
  listThreadplaneAgentRunTimeline,
  listThreadplaneFilesystemTree,
  listThreadplaneWorkspaceAgentRuns,
  listThreadplaneWorkspaceChat,
  listThreadplaneWorkspaces,
  requestThreadplaneAgentRun,
  requestThreadplaneFilesystemScan,
} from '../features/threadplane/client-functions'
import { readThreadplaneWorkspaceTextFile } from '../features/threadplane/server-functions'
import { createPollingResource } from '../lib/create-polling-resource'

export const Route = createFileRoute('/')({ component: Home })

const POLL_INTERVAL_MS = 5000
const THREADPLANE_USER_DISPLAY_NAME = 'Threadplane User'

type PathSegment = {
  label: string
  path: string
}

type RequestedBy =
  | { type: 'user'; userId?: string; displayName: string }
  | { type: 'agent'; agentId: string; displayName: string }
  | { type: 'system' }

type ScanLike = {
  status: 'requested' | 'running' | 'completed' | 'failed'
  reason: 'workspaceCreated' | 'userRequested' | 'agentToolChanged'
  requestedBy: RequestedBy
  discoveredNodeCount?: number
  changedNodeCount?: number
  deletedNodeCount?: number
  error?: string
}

function buildPathSegments(filePath: string | null): PathSegment[] {
  if (!filePath) return []
  const parts = filePath.split('/').filter(Boolean)
  return parts.map((label, index) => ({
    label,
    path: parts.slice(0, index + 1).join('/'),
  }))
}

function parentPathOf(filePath: string | null) {
  if (!filePath) return null
  const parts = filePath.split('/').filter(Boolean)
  if (parts.length <= 1) return null
  return parts.slice(0, -1).join('/')
}

function fileNameOf(filePath: string | null) {
  if (!filePath) return ''
  return filePath.split('/').filter(Boolean).at(-1) ?? filePath
}

function initials(name: string) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  return letters || 'TP'
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`
}

function formatBytes(sizeBytes: number | null | undefined) {
  if (sizeBytes == null) return 'Folder'
  if (!Number.isFinite(sizeBytes)) return 'Unknown size'
  if (sizeBytes < 1024) return `${sizeBytes} B`

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = sizeBytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function formatRequester(requestedBy: RequestedBy | undefined) {
  if (!requestedBy) return 'Unknown requester'
  if (requestedBy.type === 'system') return 'System'
  return requestedBy.displayName
}

function formatScanReason(reason: ScanLike['reason'] | undefined) {
  switch (reason) {
    case 'workspaceCreated':
      return 'Workspace created'
    case 'userRequested':
      return 'User requested'
    case 'agentToolChanged':
      return 'Agent tool changed files'
    default:
      return 'No reason recorded'
  }
}

function scanStatusTone(status: ScanLike['status'] | undefined) {
  switch (status) {
    case 'completed':
      return 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
    case 'running':
      return 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200'
    case 'requested':
      return 'border-amber-400/40 bg-amber-400/10 text-amber-200'
    case 'failed':
      return 'border-rose-400/40 bg-rose-400/10 text-rose-200'
    default:
      return 'border-slate-700 bg-slate-900 text-slate-400'
  }
}

function runStatusTone(status: string | undefined) {
  switch (status) {
    case 'completed':
      return 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
    case 'running':
      return 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200'
    case 'pending':
      return 'border-amber-400/40 bg-amber-400/10 text-amber-200'
    case 'failed':
      return 'border-rose-400/40 bg-rose-400/10 text-rose-200'
    default:
      return 'border-slate-700 bg-slate-900 text-slate-400'
  }
}

function scanSummary(scan: ScanLike | null | undefined) {
  if (!scan) return 'No scan yet'
  if (scan.status === 'completed') {
    return `${scan.discoveredNodeCount ?? 0} discovered · ${scan.changedNodeCount ?? 0} changed · ${scan.deletedNodeCount ?? 0} deleted`
  }
  if (scan.status === 'failed') return scan.error ?? 'Scan failed'
  if (scan.status === 'running') return 'Scanning workspace files'
  return 'Queued for scanning'
}

function formatError(cause: unknown) {
  if (!cause) return null
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string') return cause
  return 'Something went wrong.'
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

const iconGlyphs = {
  activity: '≋',
  bot: '✦',
  calendar: '◫',
  chat: '◌',
  file: '∷',
  folder: '▣',
  grid: '⌗',
  play: '▶',
  plus: '+',
  readme: '◇',
  refresh: '↻',
  scan: '◈',
  search: '⌕',
  send: '↵',
  status: '●',
  tasks: '☷',
  terminal: '⌁',
  up: '↑',
  workspace: '◍',
} as const

type IconName = keyof typeof iconGlyphs

function Icon(props: { name: IconName; class?: string }) {
  return (
    <span
      aria-hidden="true"
      class={`inline-flex select-none items-center justify-center font-mono leading-none ${props.class ?? ''}`}
    >
      {iconGlyphs[props.name]}
    </span>
  )
}

function Home() {
  const [workspaceDraft, setWorkspaceDraft] = createSignal('')
  const [workspaceFilter, setWorkspaceFilter] = createSignal('')
  const [messageDraft, setMessageDraft] = createSignal('')
  const [activeWorkspaceId, setActiveWorkspaceId] = createSignal<string | null>(
    null,
  )
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null)
  const [isCreatingWorkspace, setIsCreatingWorkspace] = createSignal(false)
  const [isSendingPost, setIsSendingPost] = createSignal(false)
  const [isScanning, setIsScanning] = createSignal(false)
  const [isRequestingRun, setIsRequestingRun] = createSignal(false)
  const [selectedFilePath, setSelectedFilePath] = createSignal<string | null>(
    null,
  )
  const [activeRunId, setActiveRunId] = createSignal<string | null>(null)

  const listWorkspacesFn = listThreadplaneWorkspaces
  const createWorkspaceFn = createThreadplaneWorkspace
  const listChatFn = listThreadplaneWorkspaceChat
  const createPostFn = createThreadplanePost
  const listTreeFn = listThreadplaneFilesystemTree
  const listStatusFn = getThreadplaneFilesystemStatus
  const readFileFn = useServerFn(readThreadplaneWorkspaceTextFile)
  const requestScanFn = requestThreadplaneFilesystemScan
  const requestRunFn = requestThreadplaneAgentRun
  const listRunsFn = listThreadplaneWorkspaceAgentRuns
  const listTimelineFn = listThreadplaneAgentRunTimeline

  const [workspaces, { refetch: refetchWorkspaces }] = createPollingResource(
    () => true,
    () => listWorkspacesFn(),
    { intervalMs: POLL_INTERVAL_MS, initialValue: [] },
  )

  function selectWorkspace(workspaceId: string) {
    setActiveWorkspaceId(workspaceId)
    setSelectedPath(null)
    setSelectedFilePath(null)
    setActiveRunId(null)
  }

  createEffect(
    on(workspaces, (items) => {
      if (!items?.length) {
        if (activeWorkspaceId()) {
          void startTransition(() => {
            setActiveWorkspaceId(null)
            setSelectedPath(null)
            setSelectedFilePath(null)
            setActiveRunId(null)
          })
        }
        return
      }
      if (
        !activeWorkspaceId() ||
        !items.some((item) => item.id === activeWorkspaceId())
      ) {
        void startTransition(() => selectWorkspace(items[0].id))
      }
    }),
  )

  const chatSource = () => activeWorkspaceId()
  const [chat, { refetch: refetchChat }] = createPollingResource(
    chatSource,
    (workspaceId) => listChatFn({ data: { workspaceId } }),
    { intervalMs: POLL_INTERVAL_MS, initialValue: [] },
  )

  const treeSource = () => {
    const workspaceId = activeWorkspaceId()
    if (!workspaceId) return null
    return { workspaceId, parentPath: selectedPath() }
  }
  const [tree, { refetch: refetchTree }] = createPollingResource(
    treeSource,
    (source) => listTreeFn({ data: source }),
    { intervalMs: POLL_INTERVAL_MS, initialValue: [] },
  )

  const [status, { refetch: refetchStatus }] = createPollingResource(
    () => activeWorkspaceId(),
    (workspaceId) => listStatusFn({ data: { workspaceId } }),
    { intervalMs: POLL_INTERVAL_MS },
  )

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
      if (
        !activeRunId() ||
        !items?.some((item) => item.runId === activeRunId())
      ) {
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
    {
      intervalMs: POLL_INTERVAL_MS,
      initialValue: { chunks: [], toolCalls: [] },
    },
  )

  const [previewText] = createResource(selectedFilePath, async (filePath) => {
    const workspaceId = activeWorkspaceId()
    if (!workspaceId || !filePath) return ''
    return readFileFn({ data: { workspaceId, path: filePath } })
  })

  const allWorkspaces = createMemo(() => workspaces() ?? [])
  const filteredWorkspaces = createMemo(() => {
    const query = workspaceFilter().trim().toLowerCase()
    if (!query) return allWorkspaces()
    return allWorkspaces().filter((workspace) =>
      workspace.name.toLowerCase().includes(query),
    )
  })
  const activeWorkspace = createMemo(() =>
    allWorkspaces().find((item) => item.id === activeWorkspaceId()),
  )
  const activeWorkspaceName = createMemo(
    () => activeWorkspace()?.name ?? 'Select a workspace',
  )
  const visibleChat = createMemo(() => chat()?.filter(Boolean) ?? [])
  const treeNodes = createMemo(() => tree() ?? [])
  const visibleFiles = createMemo(
    () => treeNodes().filter((node) => node.kind === 'file').length,
  )
  const visibleDirectories = createMemo(
    () => treeNodes().filter((node) => node.kind === 'directory').length,
  )
  const latestScan = createMemo(() => status()?.latestScan)
  const selectedPathSegments = createMemo(() =>
    buildPathSegments(selectedPath()),
  )
  const previewErrorMessage = createMemo(() =>
    selectedFilePath() ? formatError(previewText.error) : null,
  )
  const runList = createMemo(() => runs() ?? [])
  const activeRun = createMemo(() =>
    runList().find((run) => run.runId === activeRunId()),
  )
  const currentTimeline = createMemo(
    () => timeline() ?? { chunks: [], toolCalls: [] },
  )
  const latestToolCall = createMemo(() => currentTimeline().toolCalls.at(-1))
  const toolCallCount = createMemo(() => currentTimeline().toolCalls.length)
  const timelineTranscript = createMemo(() =>
    [...currentTimeline().chunks]
      .sort((left, right) => left.sequence - right.sequence)
      .map((chunk) => chunk.delta)
      .join(''),
  )
  const isRefreshingWorkspace = createMemo(
    () =>
      chat.loading || tree.loading || Boolean(status.loading) || runs.loading,
  )

  async function createWorkspace(event: SubmitEvent) {
    event.preventDefault()
    const name = workspaceDraft().trim()
    if (!name || isCreatingWorkspace()) return
    setIsCreatingWorkspace(true)
    try {
      const created = await createWorkspaceFn({ data: { name } })
      await refetchWorkspaces()
      const newest = created.at(-1)
      if (newest) {
        void startTransition(() => {
          selectWorkspace(newest.id)
          setWorkspaceFilter('')
        })
        await requestScanFn({
          data: {
            workspaceId: newest.id,
            reason: 'workspaceCreated',
            requestedBy: { type: 'system' },
          },
        })
        await Promise.all([refetchStatus(), refetchTree()])
        setWorkspaceDraft('')
      }
    } finally {
      setIsCreatingWorkspace(false)
    }
  }

  async function submitPostDraft() {
    const content = messageDraft().trim()
    const workspaceId = activeWorkspaceId()
    if (!content || !workspaceId || isSendingPost()) return false
    setIsSendingPost(true)
    try {
      await createPostFn({
        data: {
          workspaceId,
          author: { displayName: THREADPLANE_USER_DISPLAY_NAME },
          content,
        },
      })
      setMessageDraft('')
      await refetchChat()
      return true
    } finally {
      setIsSendingPost(false)
    }
  }

  async function createPost(event: SubmitEvent) {
    event.preventDefault()
    await submitPostDraft()
  }

  async function scanWorkspace() {
    const workspaceId = activeWorkspaceId()
    if (!workspaceId || isScanning()) return
    setIsScanning(true)
    try {
      await requestScanFn({
        data: {
          workspaceId,
          reason: 'userRequested',
          requestedBy: {
            type: 'user',
            displayName: THREADPLANE_USER_DISPLAY_NAME,
          },
        },
      })
      await Promise.all([refetchStatus(), refetchTree()])
    } finally {
      setIsScanning(false)
    }
  }

  async function refreshWorkspacePanels() {
    if (!activeWorkspaceId()) return
    await Promise.all([
      refetchChat(),
      refetchTree(),
      refetchStatus(),
      refetchRuns(),
    ])
    if (activeRunId()) await refetchTimeline()
  }

  async function findLatestPostIdByContent(
    workspaceId: string,
    content: string,
  ) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const latestChat = await listChatFn({ data: { workspaceId } })
      const post = [...(latestChat ?? [])]
        .reverse()
        .find(
          (item) =>
            item.content === content &&
            item.author.displayName === 'Threadplane Demo',
        )

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
          author: { displayName: 'Threadplane Demo' },
          content: requestContent,
        },
      })
      const postId = await findLatestPostIdByContent(
        workspaceId,
        requestContent,
      )
      await requestRunFn({
        data: {
          workspaceId,
          postId,
          agentId: 'simulated-agent',
          agentName: 'Simulated Agent',
          requestedBy: {
            type: 'user',
            displayName: THREADPLANE_USER_DISPLAY_NAME,
          },
        },
      })
      const refreshedRuns = await listRunsFn({ data: { workspaceId } })
      await Promise.all([refetchChat(), refetchRuns()])
      const nextRun = refreshedRuns.at(-1)
      if (nextRun) void startTransition(() => setActiveRunId(nextRun.runId))
      if (nextRun) await refetchTimeline()
    } finally {
      setIsRequestingRun(false)
    }
  }

  return (
    <div class="min-h-screen bg-[#05070d] text-slate-100">
      <div class="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_8%_8%,rgba(34,211,238,0.16),transparent_30%),radial-gradient(circle_at_88%_12%,rgba(16,185,129,0.13),transparent_26%),linear-gradient(135deg,#030712_0%,#07111f_50%,#0b1020_100%)]" />
      <div class="pointer-events-none fixed inset-0 opacity-[0.13] [background-image:linear-gradient(rgba(148,163,184,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.12)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div class="pointer-events-none fixed inset-0 opacity-[0.055] [background-image:linear-gradient(rgba(125,211,252,0.22)_1px,transparent_1px)] [background-size:100%_4px]" />

      <main class="relative mx-auto grid min-h-screen w-full max-w-[1680px] auto-rows-min grid-cols-1 gap-3 p-3 md:p-4 xl:h-screen xl:auto-rows-auto xl:grid-cols-[18.5rem_minmax(0,1fr)_25rem] xl:grid-rows-[auto_minmax(0,1fr)_auto] xl:overflow-hidden">
        <aside class="order-1 flex min-h-[24rem] max-h-[34rem] flex-col overflow-hidden rounded-[1.75rem] border border-cyan-100/10 bg-[#07101c]/85 shadow-2xl shadow-black/35 ring-1 ring-white/5 backdrop-blur-xl sm:min-h-[28rem] xl:order-none xl:col-start-1 xl:row-span-3 xl:min-h-0 xl:max-h-none">
          <div class="border-b border-white/10 p-4">
            <div class="flex items-center justify-between gap-3">
              <div class="flex min-w-0 items-center gap-3">
                <span class="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-100 shadow-lg shadow-cyan-950/20">
                  <Icon name="terminal" class="text-xl" />
                </span>
                <div class="min-w-0">
                  <p class="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.28em] text-cyan-200/80">
                    Specter
                  </p>
                  <h2 class="truncate text-lg font-semibold tracking-tight text-white">
                    Threadplane
                  </h2>
                </div>
              </div>
              <button
                type="button"
                aria-label="Refresh workspaces"
                title="Refresh workspaces"
                class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-cyan-300/45 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void refetchWorkspaces()}
                disabled={workspaces.loading}
              >
                <Icon
                  name="refresh"
                  class={workspaces.loading ? 'animate-spin' : ''}
                />
              </button>
            </div>

            <form onSubmit={createWorkspace} class="mt-5 space-y-2">
              <div>
                <label
                  for="threadplane-workspace-name"
                  class="block font-mono text-[0.66rem] font-semibold uppercase tracking-[0.24em] text-slate-500"
                >
                  New Workspace
                </label>
                <div class="mt-2 flex gap-2">
                  <input
                    id="threadplane-workspace-name"
                    class="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-60"
                    value={workspaceDraft()}
                    onInput={(event) =>
                      setWorkspaceDraft(event.currentTarget.value)
                    }
                    placeholder="Workspace name"
                    disabled={isCreatingWorkspace()}
                  />
                  <button
                    type="submit"
                    aria-label="Create Workspace"
                    title="Create Workspace"
                    class="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-cyan-300 text-lg font-semibold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!workspaceDraft().trim() || isCreatingWorkspace()}
                  >
                    <Icon
                      name={isCreatingWorkspace() ? 'refresh' : 'plus'}
                      class={isCreatingWorkspace() ? 'animate-spin' : ''}
                    />
                  </button>
                </div>
              </div>
            </form>

            <div class="mt-4">
              <label
                for="threadplane-workspace-filter"
                class="block font-mono text-[0.66rem] font-semibold uppercase tracking-[0.24em] text-slate-500"
              >
                Find Workspace
              </label>
              <div class="mt-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 transition focus-within:border-emerald-300/50 focus-within:ring-2 focus-within:ring-emerald-300/10">
                <Icon name="search" class="text-slate-500" />
                <input
                  id="threadplane-workspace-filter"
                  class="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
                  value={workspaceFilter()}
                  onInput={(event) =>
                    setWorkspaceFilter(event.currentTarget.value)
                  }
                  placeholder="Filter workspaces"
                />
              </div>
            </div>

            <div class="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div class="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <div class="font-mono uppercase tracking-[0.18em] text-slate-500">
                  Nodes
                </div>
                <div class="mt-1 font-semibold text-white">
                  {allWorkspaces().length}
                </div>
              </div>
              <div class="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <div class="font-mono uppercase tracking-[0.18em] text-slate-500">
                  Link
                </div>
                <div class="mt-1 font-semibold text-emerald-200">
                  {workspaces.loading ? 'Sync' : 'Idle'}
                </div>
              </div>
            </div>
          </div>

          <nav
            class="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
            aria-label="Workspaces"
          >
            <Show
              when={allWorkspaces().length > 0}
              fallback={
                <div class="rounded-2xl border border-dashed border-cyan-100/15 bg-white/[0.02] p-4 text-sm leading-6 text-slate-400">
                  Create a workspace to anchor chat, scans, previews, and runs.
                </div>
              }
            >
              <Show
                when={filteredWorkspaces().length > 0}
                fallback={
                  <div class="rounded-2xl border border-dashed border-cyan-100/15 bg-white/[0.02] p-4 text-sm text-slate-400">
                    No workspaces match “{workspaceFilter().trim()}”.
                  </div>
                }
              >
                <For each={filteredWorkspaces()}>
                  {(workspace) => {
                    const isActive = () => workspace.id === activeWorkspaceId()
                    return (
                      <button
                        type="button"
                        aria-label={workspace.name}
                        class={`group flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${isActive() ? 'border-cyan-300/55 bg-cyan-300/12 shadow-lg shadow-cyan-950/20' : 'border-white/10 bg-white/[0.03] hover:border-cyan-100/20 hover:bg-white/[0.06]'}`}
                        onClick={() => selectWorkspace(workspace.id)}
                      >
                        <span
                          class={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl font-mono text-xs font-bold ${isActive() ? 'bg-cyan-300 text-slate-950' : 'bg-slate-900 text-slate-300 ring-1 ring-white/10 group-hover:text-cyan-100'}`}
                        >
                          {initials(workspace.name)}
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-sm font-semibold text-white">
                            {workspace.name}
                          </span>
                          <span class="mt-0.5 block truncate font-mono text-[0.68rem] text-slate-500">
                            {shortId(workspace.id)}
                          </span>
                        </span>
                        <span
                          class={`h-2.5 w-2.5 shrink-0 rounded-full ${isActive() ? 'bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.85)]' : 'bg-slate-700'}`}
                          aria-hidden="true"
                        />
                      </button>
                    )
                  }}
                </For>
              </Show>
            </Show>
          </nav>
        </aside>

        <header class="order-2 flex flex-col gap-3 rounded-[1.75rem] border border-white/10 bg-[#07101c]/80 p-3 shadow-2xl shadow-black/30 ring-1 ring-white/5 backdrop-blur-xl md:flex-row md:items-center md:justify-between xl:order-none xl:col-span-2 xl:col-start-2 xl:row-start-1">
          <div class="flex min-w-0 items-center gap-3 px-1">
            <span class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-emerald-300/30 bg-emerald-300/10 text-emerald-100">
              <Icon name="grid" />
            </span>
            <div class="min-w-0">
              <p class="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.32em] text-emerald-200/75">
                Threadplane / Ref
              </p>
              <h1 class="truncate text-xl font-semibold tracking-tight text-white">
                Reference UI
              </h1>
            </div>
          </div>

          <nav
            aria-label="Visual application tabs"
            class="flex w-full min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-black/20 p-1 md:w-auto md:max-w-xl"
          >
            <button
              type="button"
              aria-label="Thread tab (visual only)"
              class="flex shrink-0 items-center gap-2 rounded-xl bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 shadow-lg shadow-cyan-950/30"
              title="Thread tab (visual only)"
            >
              <Icon name="chat" />
              <span class="hidden lg:inline">Thread</span>
            </button>
            <button
              type="button"
              aria-label="Tasks tab (visual only)"
              aria-disabled="true"
              class="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200"
              title="Tasks tab (visual only)"
            >
              <Icon name="tasks" />
              <span class="hidden lg:inline">Tasks</span>
            </button>
            <button
              type="button"
              aria-label="Calendar tab (visual only)"
              aria-disabled="true"
              class="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200"
              title="Calendar tab (visual only)"
            >
              <Icon name="calendar" />
              <span class="hidden lg:inline">Cal</span>
            </button>
            <button
              type="button"
              aria-label="Readme tab (visual only)"
              aria-disabled="true"
              class="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200"
              title="Readme tab (visual only)"
            >
              <Icon name="readme" />
              <span class="hidden lg:inline">Readme</span>
            </button>
          </nav>

          <div class="flex w-full shrink-0 items-center justify-between gap-2 md:w-auto md:justify-start">
            <span class="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-300">
              <span class="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.75)]" />
              {workspaces.loading ? 'Sync' : '5s poll'}
            </span>
            <button
              type="button"
              aria-label="Refresh workspace"
              title="Refresh workspace"
              class="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-cyan-300/45 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void refreshWorkspacePanels()}
              disabled={!activeWorkspaceId() || isRefreshingWorkspace()}
            >
              <Icon
                name="refresh"
                class={isRefreshingWorkspace() ? 'animate-spin' : ''}
              />
            </button>
          </div>
        </header>

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
                  {activeWorkspaceName()}
                </h2>
                <p class="mt-2 text-sm leading-6 text-slate-400">
                  <Show
                    when={activeWorkspaceId()}
                    fallback="Create or select a workspace to start the reference flow."
                  >
                    {formatCount(visibleChat().length, 'post')} · reactions keep
                    agent replies on the Specter event path.
                  </Show>
                </p>
              </div>
              <div class="grid grid-cols-3 gap-2 text-xs lg:w-[22rem]">
                <div class="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <div class="font-mono uppercase tracking-[0.18em] text-slate-500">
                    Chat
                  </div>
                  <div class="mt-1 font-semibold text-white">
                    {visibleChat().length}
                  </div>
                </div>
                <div class="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <div class="font-mono uppercase tracking-[0.18em] text-slate-500">
                    Files
                  </div>
                  <div class="mt-1 font-semibold text-white">
                    {visibleFiles()}
                  </div>
                </div>
                <div class="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <div class="font-mono uppercase tracking-[0.18em] text-slate-500">
                    Runs
                  </div>
                  <div class="mt-1 font-semibold text-white">
                    {runList().length}
                  </div>
                </div>
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
                      Workspaces anchor chat posts, filesystem scans, file
                      previews, and agent run history.
                    </p>
                  </div>
                </div>
              }
            >
              <Show
                when={!(chat.loading && visibleChat().length === 0)}
                fallback={
                  <div class="space-y-3">
                    <div class="h-24 w-2/3 animate-pulse rounded-3xl bg-white/5" />
                    <div class="ml-auto h-20 w-1/2 animate-pulse rounded-3xl bg-white/10" />
                  </div>
                }
              >
                <Show
                  when={visibleChat().length > 0}
                  fallback={
                    <div class="grid min-h-80 place-items-center rounded-3xl border border-dashed border-cyan-100/15 bg-white/[0.025] p-8 text-center">
                      <div>
                        <div class="mx-auto grid h-14 w-14 place-items-center rounded-3xl border border-white/10 bg-slate-900 text-2xl text-slate-300">
                          <Icon name="chat" />
                        </div>
                        <h3 class="mt-4 text-lg font-semibold text-white">
                          Start the thread
                        </h3>
                        <p class="mt-2 max-w-md text-sm leading-6 text-slate-400">
                          Post a prompt, scan the workspace, then simulate an
                          agent run to see replies arrive through reactions.
                        </p>
                      </div>
                    </div>
                  }
                >
                  <For each={visibleChat()}>
                    {(message) => {
                      const isAgent = () => message.author.type === 'agent'
                      return (
                        <article
                          class={`group flex max-w-full gap-3 sm:max-w-[min(48rem,94%)] ${isAgent() ? '' : 'ml-auto flex-row-reverse'}`}
                        >
                          <div
                            class={`mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-2xl text-xs font-bold shadow-lg ${isAgent() ? 'bg-cyan-300 text-slate-950 shadow-cyan-950/30' : 'bg-slate-100 text-slate-950 shadow-black/20'}`}
                          >
                            {isAgent() ? (
                              <Icon name="bot" />
                            ) : (
                              initials(message.author.displayName)
                            )}
                          </div>
                          <div
                            class={`rounded-3xl border px-4 py-3 shadow-lg ${isAgent() ? 'border-cyan-300/20 bg-cyan-300/10 text-cyan-50 shadow-cyan-950/20' : 'border-white/20 bg-slate-100 text-slate-950 shadow-black/20'}`}
                          >
                            <div class="mb-1 flex flex-wrap items-center gap-2 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.18em] opacity-70">
                              <span>{message.author.displayName}</span>
                              <Show when={message.parentPostId}>
                                <span class="rounded-full bg-current/10 px-2 py-0.5">
                                  Reply
                                </span>
                              </Show>
                              <Show when={message.sourceRunId}>
                                <span class="rounded-full bg-current/10 px-2 py-0.5">
                                  Run
                                </span>
                              </Show>
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
            </Show>
          </div>
        </section>

        <aside class="order-5 flex min-h-[30rem] flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#07101c]/86 shadow-2xl shadow-black/35 ring-1 ring-white/5 backdrop-blur-xl sm:min-h-[36rem] xl:order-none xl:col-start-3 xl:row-start-2 xl:min-h-0">
          <header class="border-b border-white/10 p-3.5">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.28em] text-emerald-200/75">
                  Right Rail
                </p>
                <h2 class="truncate text-lg font-semibold tracking-tight text-white">
                  Activity
                </h2>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  aria-label="Scan"
                  title={isScanning() ? 'Scanning...' : 'Scan'}
                  class="grid h-9 w-9 place-items-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-100 transition hover:border-cyan-200/60 hover:bg-cyan-300/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={scanWorkspace}
                  disabled={!activeWorkspaceId() || isScanning()}
                >
                  <Icon
                    name="scan"
                    class={isScanning() ? 'animate-pulse' : ''}
                  />
                </button>
                <button
                  type="button"
                  aria-label="Simulate run"
                  title={isRequestingRun() ? 'Starting...' : 'Simulate run'}
                  class="grid h-9 w-9 place-items-center rounded-2xl bg-emerald-300 text-slate-950 shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={simulateAgentRun}
                  disabled={!activeWorkspaceId() || isRequestingRun()}
                >
                  <Icon
                    name={isRequestingRun() ? 'refresh' : 'play'}
                    class={isRequestingRun() ? 'animate-spin' : ''}
                  />
                </button>
              </div>
            </div>
          </header>

          <div class="min-h-0 flex-1 overflow-hidden p-2.5">
            <div class="grid h-full min-h-0 grid-rows-[1.35fr_0.95fr_1fr] gap-2.5">
              <section class="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-cyan-100/10 bg-slate-950/45 p-3 shadow-inner shadow-black/20">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <h3 class="flex items-center gap-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-slate-300">
                      <Icon name="folder" class="text-cyan-200" />
                      Files
                    </h3>
                    <p class="mt-0.5 truncate text-[0.68rem] text-slate-500">
                      {visibleDirectories()} folders · {visibleFiles()} files
                    </p>
                  </div>
                  <span
                    class={`shrink-0 rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold ${scanStatusTone(latestScan()?.status)}`}
                  >
                    {status()?.initialized ? 'Init' : 'Cold'}
                  </span>
                </div>

                <div
                  class="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-2.5 py-1.5"
                  title={
                    latestScan()
                      ? `${formatScanReason(latestScan()?.reason)} · ${formatRequester(latestScan()?.requestedBy)}`
                      : undefined
                  }
                >
                  <span class="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.7)]" />
                  <p class="truncate text-xs text-slate-400">
                    Latest {latestScan()?.status ?? 'scan pending'} ·{' '}
                    {scanSummary(latestScan())}
                  </p>
                </div>

                <Show when={selectedPath()}>
                  <div class="mt-2 flex items-center gap-1.5 overflow-x-auto text-[0.68rem]">
                    <button
                      type="button"
                      class="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-semibold text-slate-300 transition hover:border-cyan-300/40 hover:text-cyan-100"
                      onClick={() => {
                        setSelectedPath(null)
                        setSelectedFilePath(null)
                      }}
                    >
                      Root
                    </button>
                    <For each={selectedPathSegments()}>
                      {(segment) => (
                        <>
                          <span class="text-slate-700">/</span>
                          <button
                            type="button"
                            class={`shrink-0 rounded-full border px-2.5 py-1 font-semibold transition ${segment.path === selectedPath() ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100' : 'border-white/10 bg-white/5 text-slate-300 hover:border-cyan-300/40 hover:text-cyan-100'}`}
                            onClick={() => {
                              setSelectedPath(segment.path)
                              setSelectedFilePath(null)
                            }}
                          >
                            {segment.label}
                          </button>
                        </>
                      )}
                    </For>
                    <button
                      type="button"
                      aria-label="Up one folder"
                      title="Up one folder"
                      class="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 text-slate-400 transition hover:border-white/20 hover:text-white"
                      onClick={() => {
                        setSelectedPath(parentPathOf(selectedPath()))
                        setSelectedFilePath(null)
                      }}
                    >
                      <Icon name="up" />
                    </button>
                  </div>
                </Show>

                <div class="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
                  <Show
                    when={activeWorkspaceId()}
                    fallback={
                      <div class="rounded-xl border border-dashed border-cyan-100/15 p-3 text-xs leading-5 text-slate-400">
                        Select a workspace to inspect filesystem metadata.
                      </div>
                    }
                  >
                    <Show
                      when={!(tree.loading && treeNodes().length === 0)}
                      fallback={
                        <div class="space-y-1.5">
                          <div class="h-9 animate-pulse rounded-xl bg-white/5" />
                          <div class="h-9 animate-pulse rounded-xl bg-white/5" />
                        </div>
                      }
                    >
                      <Show
                        when={treeNodes().length > 0}
                        fallback={
                          <div class="rounded-xl border border-dashed border-cyan-100/15 p-3 text-xs leading-5 text-slate-400">
                            Empty folder, or scan has not populated the tree.
                          </div>
                        }
                      >
                        <div class="space-y-1.5">
                          <For each={treeNodes()}>
                            {(node) => {
                              const isSelected = () =>
                                node.kind === 'file'
                                  ? node.path === selectedFilePath()
                                  : node.path === selectedPath()
                              return (
                                <button
                                  type="button"
                                  aria-label={`${node.kind === 'directory' ? '📁' : '📄'} ${node.name}`}
                                  class={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition ${isSelected() ? 'border-cyan-300/60 bg-cyan-300/15' : 'border-white/10 bg-slate-950/55 hover:border-cyan-100/20 hover:bg-slate-900/70'}`}
                                  onClick={() => {
                                    if (node.kind === 'directory') {
                                      setSelectedPath(node.path)
                                      setSelectedFilePath(null)
                                    } else {
                                      setSelectedFilePath(node.path)
                                    }
                                  }}
                                >
                                  <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.04] text-xs text-cyan-100">
                                    <Icon
                                      name={
                                        node.kind === 'directory'
                                          ? 'folder'
                                          : 'file'
                                      }
                                    />
                                  </span>
                                  <span class="min-w-0 flex-1">
                                    <span class="block truncate text-xs font-semibold text-slate-100">
                                      {node.name}
                                    </span>
                                    <span class="block truncate font-mono text-[0.62rem] text-slate-500">
                                      {node.path}
                                    </span>
                                  </span>
                                  <span class="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[0.68rem] text-slate-400">
                                    {formatBytes(node.sizeBytes)}
                                  </span>
                                </button>
                              )
                            }}
                          </For>
                        </div>
                      </Show>
                    </Show>
                  </Show>
                </div>
              </section>

              <section class="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-emerald-100/10 bg-slate-950/45 p-3 shadow-inner shadow-black/20">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <h3 class="flex items-center gap-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-slate-300">
                      <Icon name="file" class="text-emerald-200" />
                      Preview
                    </h3>
                    <p class="mt-0.5 truncate text-[0.68rem] text-slate-500">
                      Guarded UTF-8 read
                    </p>
                  </div>
                  <Show when={selectedFilePath()}>
                    <span class="max-w-[9rem] truncate rounded-full border border-white/10 bg-black/25 px-2 py-0.5 text-[0.68rem] font-semibold text-slate-300">
                      {fileNameOf(selectedFilePath())}
                    </span>
                  </Show>
                </div>

                <div class="mt-2 min-h-0 flex-1 overflow-y-auto">
                  <Show
                    when={selectedFilePath()}
                    fallback={
                      <div class="rounded-xl border border-dashed border-emerald-100/15 bg-white/[0.02] p-3 text-xs leading-5 text-slate-400">
                        Select a file to preview text. Binary, symlink, and
                        escaping paths stay blocked.
                      </div>
                    }
                  >
                    <Show
                      when={!previewText.loading}
                      fallback={
                        <div class="h-12 animate-pulse rounded-xl border border-white/10 bg-white/5" />
                      }
                    >
                      <Show
                        when={!previewErrorMessage()}
                        fallback={
                          <div class="rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-xs leading-5 text-rose-100">
                            <div class="font-semibold">Preview unavailable</div>
                            <p class="mt-1 text-rose-100/80">
                              {previewErrorMessage()}
                            </p>
                          </div>
                        }
                      >
                        <Show
                          when={(previewText() ?? '').length > 0}
                          fallback={
                            <div class="rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-slate-400">
                              File is empty.
                            </div>
                          }
                        >
                          <pre class="m-0 max-h-28 overflow-auto rounded-xl border border-emerald-300/10 bg-black/35 p-3 font-mono text-[0.68rem] leading-5 text-slate-200 shadow-inner shadow-black/30">
                            <code>{previewText()}</code>
                          </pre>
                        </Show>
                      </Show>
                    </Show>
                  </Show>
                </div>
              </section>

              <div class="grid min-h-0 grid-cols-1 gap-2.5 sm:grid-cols-2">
                <section class="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-cyan-100/10 bg-slate-950/45 p-2.5 shadow-inner shadow-black/20">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <h3 class="flex items-center gap-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-slate-300">
                        <Icon name="bot" class="text-cyan-200" />
                        Runs
                      </h3>
                    </div>
                    <span
                      class={`shrink-0 rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold ${runStatusTone(activeRun()?.status)}`}
                    >
                      {activeRun()?.status ?? 'none'}
                    </span>
                  </div>

                  <div class="mt-1.5 min-h-0 flex-1 overflow-y-auto pr-1">
                    <Show
                      when={runList().length > 0}
                      fallback={
                        <div class="rounded-xl border border-dashed border-cyan-100/15 p-2.5 text-xs leading-5 text-slate-400">
                          No runs yet. Press play after selecting a workspace.
                        </div>
                      }
                    >
                      <div class="space-y-1.5">
                        <For each={[...runList()].reverse()}>
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
                                      {run.agentName ?? 'Agent'} ·{' '}
                                      {run.status ?? 'unknown'}
                                    </div>
                                    <div class="truncate font-mono text-[0.62rem] text-slate-500">
                                      {shortId(run.runId)} ·{' '}
                                      {formatCount(runList().length, 'run')}
                                    </div>
                                  </div>
                                  <span
                                    class={`shrink-0 rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold ${runStatusTone(run.status)}`}
                                  >
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

                <section class="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-emerald-100/10 bg-slate-950/45 p-2.5 shadow-inner shadow-black/20">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <h3 class="flex items-center gap-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-slate-300">
                        <Icon name="activity" class="text-emerald-200" />
                        Timeline
                      </h3>
                      <p class="mt-0.5 truncate text-[0.68rem] text-slate-500">
                        {latestToolCall()
                          ? `${latestToolCall()?.toolName} · ${latestToolCall()?.status}`
                          : 'Stream + tool calls'}
                      </p>
                    </div>
                    <Show
                      when={timeline.loading}
                      fallback={
                        <span class="rounded-full border border-white/10 bg-black/25 px-2 py-0.5 text-[0.68rem] font-semibold text-slate-400">
                          {toolCallCount()} tools
                        </span>
                      }
                    >
                      <span class="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[0.68rem] font-semibold text-cyan-100">
                        Refreshing
                      </span>
                    </Show>
                  </div>

                  <div class="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
                    <Show
                      when={activeRun()}
                      fallback={
                        <div class="rounded-xl border border-dashed border-emerald-100/15 p-3 text-xs leading-5 text-slate-400">
                          Select or simulate a run to inspect timeline activity.
                        </div>
                      }
                    >
                      <div class="space-y-2">
                        <div>
                          <div class="mb-1 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Tool calls
                          </div>
                          <Show
                            when={currentTimeline().toolCalls.length > 0}
                            fallback={
                              <div class="rounded-xl border border-dashed border-cyan-100/15 p-2.5 text-xs leading-5 text-slate-400">
                                No tool calls recorded for this run.
                              </div>
                            }
                          >
                            <div class="space-y-1.5">
                              <For
                                each={[
                                  ...currentTimeline().toolCalls,
                                ].reverse()}
                              >
                                {(toolCall) => (
                                  <div class="rounded-xl border border-white/10 bg-slate-950/55 px-2.5 py-1.5">
                                    <div class="flex items-center justify-between gap-2">
                                      <div class="truncate text-xs font-semibold text-white">
                                        {toolCall.toolName}
                                      </div>
                                      <span
                                        class={`shrink-0 rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold ${runStatusTone(toolCall.status)}`}
                                      >
                                        {toolCall.status}
                                      </span>
                                    </div>
                                    <Show when={toolCall.inputSummary}>
                                      <p class="mt-0.5 truncate text-[0.68rem] text-slate-500">
                                        {toolCall.inputSummary}
                                      </p>
                                    </Show>
                                    <Show
                                      when={
                                        'outputSummary' in toolCall &&
                                        toolCall.outputSummary
                                      }
                                    >
                                      <p class="mt-0.5 truncate text-[0.68rem] text-emerald-200/80">
                                        {'outputSummary' in toolCall
                                          ? toolCall.outputSummary
                                          : ''}
                                      </p>
                                    </Show>
                                    <Show
                                      when={
                                        'error' in toolCall && toolCall.error
                                      }
                                    >
                                      <p class="mt-0.5 truncate text-[0.68rem] text-rose-200/80">
                                        {'error' in toolCall
                                          ? toolCall.error
                                          : ''}
                                      </p>
                                    </Show>
                                  </div>
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>

                        <Show
                          when={timelineTranscript().length > 0}
                          fallback={
                            <div class="rounded-xl border border-dashed border-cyan-100/15 p-2.5 text-xs leading-5 text-slate-400">
                              No streamed text chunks yet.
                            </div>
                          }
                        >
                          <div class="max-h-16 overflow-y-auto rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-2.5 text-xs leading-5 text-cyan-50">
                            <div class="mb-1 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
                              Stream
                            </div>
                            {timelineTranscript()}
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </aside>

        <form
          onSubmit={createPost}
          class="order-4 rounded-[1.75rem] border border-white/10 bg-[#07101c]/90 p-2.5 shadow-2xl shadow-black/35 ring-1 ring-white/5 backdrop-blur-xl transition focus-within:border-cyan-300/50 focus-within:ring-cyan-300/10 xl:order-none xl:col-start-2 xl:row-start-3"
        >
          <div class="flex items-center justify-between gap-3 px-2">
            <label
              for="threadplane-compose"
              class="flex items-center gap-2 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-slate-500"
            >
              <Icon name="terminal" class="text-cyan-200" />
              Compose
            </label>
            <span class="hidden text-xs text-slate-500 sm:inline">
              Ctrl/⌘ + Enter posts
            </span>
          </div>
          <div class="mt-2 flex items-end gap-2 rounded-2xl border border-white/10 bg-black/25 px-2 py-2 shadow-inner shadow-black/20">
            <span class="mb-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 font-mono text-cyan-100">
              <Icon name="terminal" />
            </span>
            <textarea
              id="threadplane-compose"
              class="min-h-12 min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm leading-6 text-white outline-none placeholder:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
              value={messageDraft()}
              onInput={(event) => setMessageDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void submitPostDraft()
                }
              }}
              placeholder="Write a post..."
              disabled={!activeWorkspaceId() || isSendingPost()}
            />
            <button
              type="submit"
              aria-label="Post"
              title={isSendingPost() ? 'Sending...' : 'Post'}
              class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan-300 text-lg font-semibold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                !activeWorkspaceId() ||
                !messageDraft().trim() ||
                isSendingPost()
              }
            >
              <Icon
                name={isSendingPost() ? 'refresh' : 'send'}
                class={isSendingPost() ? 'animate-spin' : ''}
              />
            </button>
          </div>
        </form>

        <aside class="order-6 rounded-[1.75rem] border border-white/10 bg-[#07101c]/90 p-2.5 shadow-2xl shadow-black/35 ring-1 ring-white/5 backdrop-blur-xl xl:order-none xl:col-start-3 xl:row-start-3">
          <div class="grid grid-cols-3 gap-2 text-xs">
            <div class="rounded-xl border border-white/10 bg-black/20 px-2.5 py-1.5">
              <div class="font-mono uppercase tracking-[0.18em] text-slate-500">
                Sync
              </div>
              <div class="mt-0.5 truncate font-semibold text-white">
                {isRefreshingWorkspace() ? 'busy' : 'idle'}
              </div>
            </div>
            <div class="rounded-xl border border-white/10 bg-black/20 px-2.5 py-1.5">
              <div class="font-mono uppercase tracking-[0.18em] text-slate-500">
                Scan
              </div>
              <div class="mt-0.5 truncate font-semibold text-cyan-100">
                {latestScan()?.status ?? 'none'}
              </div>
            </div>
            <div class="rounded-xl border border-white/10 bg-black/20 px-2.5 py-1.5">
              <div class="font-mono uppercase tracking-[0.18em] text-slate-500">
                Run
              </div>
              <div class="mt-0.5 truncate font-semibold text-emerald-100">
                {activeRun()?.status ?? 'none'}
              </div>
            </div>
          </div>
          <p class="mt-1.5 truncate px-1 font-mono text-[0.68rem] text-slate-500">
            {selectedFilePath() ?? selectedPath() ?? activeWorkspaceName()}
          </p>
        </aside>
      </main>
    </div>
  )
}
