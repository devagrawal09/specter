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
  readThreadplaneWorkspaceTextFile,
  requestThreadplaneAgentRun,
  requestThreadplaneFilesystemScan,
} from '../features/threadplane/server-functions'
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

  const listWorkspacesFn = useServerFn(listThreadplaneWorkspaces)
  const createWorkspaceFn = useServerFn(createThreadplaneWorkspace)
  const listChatFn = useServerFn(listThreadplaneWorkspaceChat)
  const createPostFn = useServerFn(createThreadplanePost)
  const listTreeFn = useServerFn(listThreadplaneFilesystemTree)
  const listStatusFn = useServerFn(getThreadplaneFilesystemStatus)
  const readFileFn = useServerFn(readThreadplaneWorkspaceTextFile)
  const requestScanFn = useServerFn(requestThreadplaneFilesystemScan)
  const requestRunFn = useServerFn(requestThreadplaneAgentRun)
  const listRunsFn = useServerFn(listThreadplaneWorkspaceAgentRuns)
  const listTimelineFn = useServerFn(listThreadplaneAgentRunTimeline)

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
    <div class="min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div class="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(34,211,238,0.2),transparent_32%),radial-gradient(circle_at_85%_15%,rgba(129,140,248,0.18),transparent_34%),linear-gradient(135deg,#020617_0%,#0f172a_48%,#111827_100%)]" />
      <main class="relative mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-5 p-3 sm:p-5 lg:p-6">
        <header class="overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-6">
          <div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div class="max-w-3xl">
              <p class="inline-flex rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200">
                Specter Threadplane
              </p>
              <h1 class="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Reference UI
              </h1>
              <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                Polling server functions over Specter slices for workspaces,
                chat, filesystem scans, guarded file previews, and simulated
                agent runs.
              </p>
            </div>
            <div class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:min-w-[28rem]">
              <div class="rounded-2xl border border-white/10 bg-slate-950/50 p-3">
                <div class="text-slate-500">Workspaces</div>
                <div class="mt-1 text-lg font-semibold text-white">
                  {allWorkspaces().length}
                </div>
              </div>
              <div class="rounded-2xl border border-white/10 bg-slate-950/50 p-3">
                <div class="text-slate-500">Active thread</div>
                <div class="mt-1 text-lg font-semibold text-white">
                  {formatCount(visibleChat().length, 'post')}
                </div>
              </div>
              <div class="col-span-2 rounded-2xl border border-white/10 bg-slate-950/50 p-3 sm:col-span-1">
                <div class="text-slate-500">Transport</div>
                <div class="mt-1 font-semibold text-cyan-200">
                  {workspaces.loading ? 'Syncing' : '5s polling'}
                </div>
              </div>
            </div>
          </div>
        </header>

        <div class="grid flex-1 gap-5 lg:grid-cols-[20rem_minmax(0,1fr)_24rem]">
          <aside class="flex min-h-[32rem] flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 shadow-2xl shadow-black/30 backdrop-blur-xl lg:max-h-[calc(100vh-11rem)]">
            <div class="border-b border-white/10 p-4">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <h2 class="text-lg font-semibold text-white">Workspaces</h2>
                  <p class="text-xs text-slate-500">
                    {formatCount(allWorkspaces().length, 'available workspace')}
                  </p>
                </div>
                <button
                  type="button"
                  class="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-cyan-300/50 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void refetchWorkspaces()}
                  disabled={workspaces.loading}
                >
                  {workspaces.loading ? 'Syncing...' : 'Refresh'}
                </button>
              </div>

              <form onSubmit={createWorkspace} class="mt-4 space-y-2">
                <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  New Workspace
                  <input
                    class="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900/90 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/10"
                    value={workspaceDraft()}
                    onInput={(event) =>
                      setWorkspaceDraft(event.currentTarget.value)
                    }
                    placeholder="Workspace name"
                    disabled={isCreatingWorkspace()}
                  />
                </label>
                <button
                  type="submit"
                  class="w-full rounded-2xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!workspaceDraft().trim() || isCreatingWorkspace()}
                >
                  {isCreatingWorkspace() ? 'Creating...' : 'Create Workspace'}
                </button>
              </form>

              <label class="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Find Workspace
                <input
                  class="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-indigo-300/60 focus:ring-2 focus:ring-indigo-300/10"
                  value={workspaceFilter()}
                  onInput={(event) =>
                    setWorkspaceFilter(event.currentTarget.value)
                  }
                  placeholder="Filter workspaces"
                />
              </label>
            </div>

            <nav
              class="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
              aria-label="Workspaces"
            >
              <Show
                when={allWorkspaces().length > 0}
                fallback={
                  <div class="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                    Create a workspace to begin scanning files and posting to a
                    thread.
                  </div>
                }
              >
                <Show
                  when={filteredWorkspaces().length > 0}
                  fallback={
                    <div class="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                      No workspaces match “{workspaceFilter().trim()}”.
                    </div>
                  }
                >
                  <For each={filteredWorkspaces()}>
                    {(workspace) => {
                      const isActive = () =>
                        workspace.id === activeWorkspaceId()
                      return (
                        <button
                          type="button"
                          aria-label={workspace.name}
                          class={`group flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${isActive() ? 'border-cyan-300/60 bg-cyan-300/15 shadow-lg shadow-cyan-950/20' : 'border-white/10 bg-slate-900/70 hover:border-white/20 hover:bg-slate-900'}`}
                          onClick={() => selectWorkspace(workspace.id)}
                        >
                          <span
                            class={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-sm font-bold ${isActive() ? 'bg-cyan-300 text-slate-950' : 'bg-slate-800 text-slate-300 group-hover:bg-slate-700'}`}
                          >
                            {initials(workspace.name)}
                          </span>
                          <span class="min-w-0 flex-1">
                            <span class="block truncate text-sm font-semibold text-white">
                              {workspace.name}
                            </span>
                            <span class="mt-0.5 block truncate text-xs text-slate-500">
                              {shortId(workspace.id)}
                            </span>
                          </span>
                          <span
                            class={`rounded-full px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide ${isActive() ? 'bg-cyan-300/20 text-cyan-100' : 'bg-white/5 text-slate-500'}`}
                          >
                            {isActive() ? 'Active' : 'Open'}
                          </span>
                        </button>
                      )
                    }}
                  </For>
                </Show>
              </Show>
            </nav>
          </aside>

          <section class="flex min-h-[42rem] flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 shadow-2xl shadow-black/30 backdrop-blur-xl lg:max-h-[calc(100vh-11rem)]">
            <header class="border-b border-white/10 p-4 sm:p-5">
              <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                  <p class="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
                    Active Workspace
                  </p>
                  <h2 class="mt-2 truncate text-3xl font-semibold tracking-tight text-white">
                    {activeWorkspaceName()}
                  </h2>
                  <p class="mt-2 text-sm text-slate-400">
                    <Show
                      when={activeWorkspaceId()}
                      fallback="Create or select a workspace to start the reference flow."
                    >
                      {formatCount(visibleChat().length, 'post')} in the thread
                      · replies stay on the Specter event path.
                    </Show>
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <span class="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300">
                    {chat.loading ? 'Loading chat' : 'Live via polling'}
                  </span>
                  <button
                    type="button"
                    class="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-cyan-300/50 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void refreshWorkspacePanels()}
                    disabled={!activeWorkspaceId() || isRefreshingWorkspace()}
                  >
                    {isRefreshingWorkspace() ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
              </div>
            </header>

            <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
              <Show
                when={activeWorkspaceId()}
                fallback={
                  <div class="grid h-full min-h-80 place-items-center rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
                    <div>
                      <div class="mx-auto grid h-14 w-14 place-items-center rounded-3xl bg-cyan-300/10 text-2xl">
                        ✦
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
                      <div class="grid min-h-80 place-items-center rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
                        <div>
                          <div class="mx-auto grid h-14 w-14 place-items-center rounded-3xl bg-slate-800 text-2xl">
                            💬
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
                            class={`group flex max-w-[min(46rem,92%)] gap-3 ${isAgent() ? '' : 'ml-auto flex-row-reverse'}`}
                          >
                            <div
                              class={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-xs font-bold ${isAgent() ? 'bg-cyan-300 text-slate-950' : 'bg-white text-slate-950'}`}
                            >
                              {isAgent()
                                ? 'AI'
                                : initials(message.author.displayName)}
                            </div>
                            <div
                              class={`rounded-3xl border px-4 py-3 shadow-lg ${isAgent() ? 'border-cyan-300/20 bg-cyan-300/10 text-cyan-50 shadow-cyan-950/20' : 'border-white/20 bg-white text-slate-950 shadow-black/20'}`}
                            >
                              <div class="mb-1 flex flex-wrap items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-wide opacity-70">
                                <span>{message.author.displayName}</span>
                                <Show when={message.parentPostId}>
                                  <span class="rounded-full bg-current/10 px-2 py-0.5">
                                    Reply
                                  </span>
                                </Show>
                                <Show when={message.sourceRunId}>
                                  <span class="rounded-full bg-current/10 px-2 py-0.5">
                                    Agent run
                                  </span>
                                </Show>
                              </div>
                              <p class="whitespace-pre-wrap text-sm leading-6">
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

            <form
              onSubmit={createPost}
              class="border-t border-white/10 p-4 sm:p-5"
            >
              <div class="rounded-3xl border border-white/10 bg-slate-900/80 p-2 transition focus-within:border-cyan-300/50 focus-within:ring-4 focus-within:ring-cyan-300/10">
                <textarea
                  class="min-h-24 w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                  value={messageDraft()}
                  onInput={(event) =>
                    setMessageDraft(event.currentTarget.value)
                  }
                  onKeyDown={(event) => {
                    if (
                      (event.ctrlKey || event.metaKey) &&
                      event.key === 'Enter'
                    ) {
                      event.preventDefault()
                      void submitPostDraft()
                    }
                  }}
                  placeholder="Write a post..."
                  disabled={!activeWorkspaceId() || isSendingPost()}
                />
                <div class="flex flex-col gap-3 border-t border-white/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <p class="text-xs text-slate-500">
                    Ctrl/⌘ + Enter posts. Shift + Enter keeps a new line.
                  </p>
                  <button
                    type="submit"
                    class="rounded-2xl bg-cyan-300 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={
                      !activeWorkspaceId() ||
                      !messageDraft().trim() ||
                      isSendingPost()
                    }
                  >
                    {isSendingPost() ? 'Sending...' : 'Post'}
                  </button>
                </div>
              </div>
            </form>
          </section>

          <aside class="grid min-h-[42rem] gap-5 lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto">
            <section class="rounded-3xl border border-white/10 bg-slate-950/70 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">
                    Filesystem
                  </h3>
                  <p class="mt-1 text-xs text-slate-500">
                    Tree/status through Specter slices
                  </p>
                </div>
                <button
                  type="button"
                  class="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={scanWorkspace}
                  disabled={!activeWorkspaceId() || isScanning()}
                >
                  {isScanning() ? 'Scanning...' : 'Scan'}
                </button>
              </div>

              <div class="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div class="flex flex-wrap items-center gap-2">
                  <span
                    class={`rounded-full border px-2.5 py-1 text-xs font-semibold ${scanStatusTone(latestScan()?.status)}`}
                  >
                    {status()?.initialized ? 'Initialized' : 'Uninitialized'}
                  </span>
                  <span class="text-xs font-medium text-slate-400">
                    Latest {latestScan()?.status ?? 'scan pending'}
                  </span>
                </div>
                <p class="mt-2 text-xs leading-5 text-slate-500">
                  {scanSummary(latestScan())}
                </p>
                <Show when={latestScan()}>
                  {(scan) => (
                    <p class="mt-1 text-xs text-slate-600">
                      {formatScanReason(scan().reason)} ·{' '}
                      {formatRequester(scan().requestedBy)}
                    </p>
                  )}
                </Show>
              </div>

              <div class="mt-4 flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  class={`rounded-full border px-3 py-1.5 font-semibold transition ${selectedPath() ? 'border-white/10 bg-white/5 text-slate-300 hover:border-cyan-300/40 hover:text-cyan-100' : 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100'}`}
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
                        class={`rounded-full border px-3 py-1.5 font-semibold transition ${segment.path === selectedPath() ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100' : 'border-white/10 bg-white/5 text-slate-300 hover:border-cyan-300/40 hover:text-cyan-100'}`}
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
                <Show when={selectedPath()}>
                  <button
                    type="button"
                    class="ml-auto rounded-full border border-white/10 px-3 py-1.5 font-semibold text-slate-400 transition hover:border-white/20 hover:text-white"
                    onClick={() => {
                      setSelectedPath(parentPathOf(selectedPath()))
                      setSelectedFilePath(null)
                    }}
                  >
                    ↑ Up
                  </button>
                </Show>
              </div>

              <div class="mt-4 flex items-center justify-between text-xs text-slate-500">
                <span>{selectedPath() ?? 'Workspace root'}</span>
                <span>
                  {visibleDirectories()} folders · {visibleFiles()} files
                </span>
              </div>

              <div class="mt-3 space-y-2">
                <Show
                  when={activeWorkspaceId()}
                  fallback={
                    <div class="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                      Select a workspace to inspect its filesystem metadata.
                    </div>
                  }
                >
                  <Show
                    when={!(tree.loading && treeNodes().length === 0)}
                    fallback={
                      <div class="space-y-2">
                        <div class="h-11 animate-pulse rounded-2xl bg-white/5" />
                        <div class="h-11 animate-pulse rounded-2xl bg-white/5" />
                      </div>
                    }
                  >
                    <Show
                      when={treeNodes().length > 0}
                      fallback={
                        <div class="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                          This folder is empty, or the workspace has not been
                          scanned yet.
                        </div>
                      }
                    >
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
                              class={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition ${isSelected() ? 'border-cyan-300/60 bg-cyan-300/15' : 'border-white/10 bg-slate-900/70 hover:border-white/20 hover:bg-slate-900'}`}
                              onClick={() => {
                                if (node.kind === 'directory') {
                                  setSelectedPath(node.path)
                                  setSelectedFilePath(null)
                                } else {
                                  setSelectedFilePath(node.path)
                                }
                              }}
                            >
                              <span class="text-lg">
                                {node.kind === 'directory' ? '📁' : '📄'}
                              </span>
                              <span class="min-w-0 flex-1">
                                <span class="block truncate text-sm font-semibold text-slate-100">
                                  {node.name}
                                </span>
                                <span class="block truncate text-xs text-slate-500">
                                  {node.path}
                                </span>
                              </span>
                              <span class="shrink-0 rounded-full bg-white/5 px-2 py-1 text-xs text-slate-400">
                                {formatBytes(node.sizeBytes)}
                              </span>
                            </button>
                          )
                        }}
                      </For>
                    </Show>
                  </Show>
                </Show>
              </div>
            </section>

            <section class="rounded-3xl border border-white/10 bg-slate-950/70 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">
                    Preview
                  </h3>
                  <p class="mt-1 text-xs text-slate-500">
                    Guarded direct text read exception
                  </p>
                </div>
                <Show when={selectedFilePath()}>
                  <span class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-300">
                    {fileNameOf(selectedFilePath())}
                  </span>
                </Show>
              </div>

              <Show
                when={selectedFilePath()}
                fallback={
                  <div class="mt-4 rounded-2xl border border-dashed border-white/10 p-4 text-sm leading-6 text-slate-400">
                    Select a file from the scanned tree to preview UTF-8 text.
                    Binary, symlink, oversized, and escaping paths stay blocked.
                  </div>
                }
              >
                <p class="mt-4 break-all rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-400">
                  {selectedFilePath()}
                </p>
                <Show
                  when={!previewText.loading}
                  fallback={
                    <div class="mt-3 h-40 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
                  }
                >
                  <Show
                    when={!previewErrorMessage()}
                    fallback={
                      <div class="mt-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm leading-6 text-rose-100">
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
                        <div class="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                          File is empty.
                        </div>
                      }
                    >
                      <pre class="mt-3 max-h-80 overflow-auto rounded-2xl border border-white/10 bg-slate-950 p-4 text-xs leading-5 text-slate-200 shadow-inner shadow-black/30">
                        <code>{previewText()}</code>
                      </pre>
                    </Show>
                  </Show>
                </Show>
              </Show>
            </section>

            <section class="rounded-3xl border border-white/10 bg-slate-950/70 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">
                    Agent Runs
                  </h3>
                  <p class="mt-1 text-xs text-slate-500">
                    {formatCount(runList().length, 'run')} recorded
                  </p>
                </div>
                <button
                  type="button"
                  class="rounded-xl bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={simulateAgentRun}
                  disabled={!activeWorkspaceId() || isRequestingRun()}
                >
                  {isRequestingRun() ? 'Starting...' : 'Simulate run'}
                </button>
              </div>

              <p class="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-slate-400">
                Simulation creates a user-visible request, emits the Agent Run,
                and lets the reaction path post the final agent reply.
              </p>

              <div class="mt-3 space-y-2">
                <Show
                  when={runList().length > 0}
                  fallback={
                    <div class="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                      No agent runs yet. Simulate a run after selecting a
                      workspace.
                    </div>
                  }
                >
                  <For each={[...runList()].reverse()}>
                    {(run) => {
                      const isActive = () => run.runId === activeRunId()
                      return (
                        <button
                          type="button"
                          aria-label={`${run.agentName ?? 'Agent'} · ${run.status ?? 'unknown'}`}
                          class={`w-full rounded-2xl border p-3 text-left transition ${isActive() ? 'border-cyan-300/60 bg-cyan-300/15' : 'border-white/10 bg-slate-900/70 hover:border-white/20 hover:bg-slate-900'}`}
                          onClick={() => setActiveRunId(run.runId)}
                        >
                          <div class="flex items-center justify-between gap-3">
                            <div class="min-w-0">
                              <div class="truncate text-sm font-semibold text-white">
                                {run.agentName ?? 'Agent'} ·{' '}
                                {run.status ?? 'unknown'}
                              </div>
                              <div class="mt-1 truncate text-xs text-slate-500">
                                {shortId(run.runId)}
                              </div>
                            </div>
                            <span
                              class={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${runStatusTone(run.status)}`}
                            >
                              {run.status ?? 'unknown'}
                            </span>
                          </div>
                          <div class="mt-2 text-xs text-slate-500">
                            Requested by {formatRequester(run.requestedBy)}
                          </div>
                          <Show when={run.error}>
                            <div class="mt-2 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
                              {run.error}
                            </div>
                          </Show>
                        </button>
                      )
                    }}
                  </For>
                </Show>
              </div>
            </section>

            <section class="rounded-3xl border border-white/10 bg-slate-950/70 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">
                    Timeline
                  </h3>
                  <p class="mt-1 text-xs text-slate-500">
                    Stream chunks and tool calls
                  </p>
                </div>
                <Show when={timeline.loading}>
                  <span class="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-xs font-semibold text-cyan-100">
                    Refreshing
                  </span>
                </Show>
              </div>

              <Show
                when={activeRun()}
                fallback={
                  <div class="mt-4 rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                    Select or simulate an agent run to inspect its timeline.
                  </div>
                }
              >
                {(run) => (
                  <div class="mt-4 space-y-4">
                    <div class="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                      <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0">
                          <div class="truncate text-sm font-semibold text-white">
                            {run().agentName}
                          </div>
                          <div class="mt-1 truncate text-xs text-slate-500">
                            {run().runId}
                          </div>
                        </div>
                        <span
                          class={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${runStatusTone(run().status)}`}
                        >
                          {run().status}
                        </span>
                      </div>
                    </div>

                    <div>
                      <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Assistant stream
                      </h4>
                      <Show
                        when={timelineTranscript().length > 0}
                        fallback={
                          <div class="mt-2 rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                            No streamed text chunks yet.
                          </div>
                        }
                      >
                        <div class="mt-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm leading-6 text-cyan-50">
                          {timelineTranscript()}
                        </div>
                      </Show>
                    </div>

                    <div>
                      <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Tool calls
                      </h4>
                      <div class="mt-2 space-y-2">
                        <Show
                          when={currentTimeline().toolCalls.length > 0}
                          fallback={
                            <div class="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                              No tool calls have been recorded for this run.
                            </div>
                          }
                        >
                          <For each={currentTimeline().toolCalls}>
                            {(toolCall) => (
                              <div class="rounded-2xl border border-white/10 bg-slate-900/70 p-3">
                                <div class="flex items-center justify-between gap-3">
                                  <div class="truncate text-sm font-semibold text-white">
                                    {toolCall.toolName}
                                  </div>
                                  <span
                                    class={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${runStatusTone(toolCall.status)}`}
                                  >
                                    {toolCall.status}
                                  </span>
                                </div>
                                <Show when={toolCall.inputSummary}>
                                  <p class="mt-2 text-xs leading-5 text-slate-400">
                                    Input: {toolCall.inputSummary}
                                  </p>
                                </Show>
                                <Show
                                  when={
                                    'outputSummary' in toolCall &&
                                    toolCall.outputSummary
                                  }
                                >
                                  <p class="mt-2 text-xs leading-5 text-emerald-200/80">
                                    Output:{' '}
                                    {'outputSummary' in toolCall
                                      ? toolCall.outputSummary
                                      : ''}
                                  </p>
                                </Show>
                                <Show
                                  when={'error' in toolCall && toolCall.error}
                                >
                                  <p class="mt-2 text-xs leading-5 text-rose-200/80">
                                    Error:{' '}
                                    {'error' in toolCall ? toolCall.error : ''}
                                  </p>
                                </Show>
                              </div>
                            )}
                          </For>
                        </Show>
                      </div>
                    </div>
                  </div>
                )}
              </Show>
            </section>
          </aside>
        </div>
      </main>
    </div>
  )
}
