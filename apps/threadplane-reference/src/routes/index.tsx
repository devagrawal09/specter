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
} from 'solid-js'

import { createPollingResource } from '../lib/create-polling-resource'
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
  replyToThreadplanePost,
} from '../features/threadplane/server-functions'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const [workspaceDraft, setWorkspaceDraft] = createSignal('')
  const [messageDraft, setMessageDraft] = createSignal('')
  const [activeWorkspaceId, setActiveWorkspaceId] = createSignal<string | null>(
    null,
  )
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null)
  const [isCreatingWorkspace, setIsCreatingWorkspace] = createSignal(false)
  const [isSendingPost, setIsSendingPost] = createSignal(false)
  const [isScanning, setIsScanning] = createSignal(false)
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
  const replyToPostFn = useServerFn(replyToThreadplanePost)

  const [workspaces, { refetch: refetchWorkspaces }] = createPollingResource(
    () => true,
    () => listWorkspacesFn(),
    { intervalMs: 5000, initialValue: [] },
  )

  createEffect(
    on(workspaces, (items) => {
      if (!items?.length) return
      if (
        !activeWorkspaceId() ||
        !items.some((item) => item.id === activeWorkspaceId())
      ) {
        setActiveWorkspaceId(items[0].id)
        setSelectedPath(null)
        setSelectedFilePath(null)
        setActiveRunId(null)
      }
    }),
  )

  const chatSource = () => activeWorkspaceId()
  const [chat] = createPollingResource(
    chatSource,
    (workspaceId) => listChatFn({ data: { workspaceId } }),
    { intervalMs: 5000, initialValue: [] },
  )

  const treeSource = () => {
    const workspaceId = activeWorkspaceId()
    if (!workspaceId) return null
    return { workspaceId, parentPath: selectedPath() }
  }
  const [tree] = createPollingResource(
    treeSource,
    (source) => listTreeFn({ data: source }),
    { intervalMs: 5000, initialValue: [] },
  )

  const [status] = createPollingResource(
    () => activeWorkspaceId(),
    (workspaceId) => listStatusFn({ data: { workspaceId } }),
    { intervalMs: 5000 },
  )

  const [runs] = createPollingResource(
    () => activeWorkspaceId(),
    (workspaceId) => listRunsFn({ data: { workspaceId } }),
    { intervalMs: 5000, initialValue: [] },
  )

  createEffect(
    on(runs, (items) => {
      const latest = items?.[items.length - 1]
      if (!activeRunId() && latest) setActiveRunId(latest.runId)
    }),
  )

  const [timeline] = createPollingResource(
    () => {
      const workspaceId = activeWorkspaceId()
      const runId = activeRunId()
      if (!workspaceId || !runId) return null
      return { workspaceId, runId }
    },
    (source) => listTimelineFn({ data: source }),
    { intervalMs: 5000, initialValue: { chunks: [], toolCalls: [] } },
  )

  const [previewText] = createResource(selectedFilePath, async (filePath) => {
    const workspaceId = activeWorkspaceId()
    if (!workspaceId || !filePath) return ''
    return readFileFn({ data: { workspaceId, path: filePath } })
  })

  const activeWorkspaceName = createMemo(
    () =>
      workspaces()?.find((item) => item.id === activeWorkspaceId())?.name ??
      'Select a workspace',
  )

  const visibleChat = createMemo(() => chat()?.filter(Boolean) ?? [])

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
        setActiveWorkspaceId(newest.id)
        setSelectedPath(null)
        setSelectedFilePath(null)
        await requestScanFn({
          data: {
            workspaceId: newest.id,
            reason: 'workspaceCreated',
            requestedBy: { type: 'system' },
          },
        })
        setWorkspaceDraft('')
      }
    } finally {
      setIsCreatingWorkspace(false)
    }
  }

  async function createPost(event: SubmitEvent) {
    event.preventDefault()
    const content = messageDraft().trim()
    const workspaceId = activeWorkspaceId()
    if (!content || !workspaceId || isSendingPost()) return
    setIsSendingPost(true)
    try {
      await createPostFn({
        data: {
          workspaceId,
          author: { displayName: 'Threadplane User' },
          content,
        },
      })
      setMessageDraft('')
    } finally {
      setIsSendingPost(false)
    }
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
          requestedBy: { type: 'user', displayName: 'Threadplane User' },
        },
      })
    } finally {
      setIsScanning(false)
    }
  }

  async function simulateAgentRun() {
    const workspaceId = activeWorkspaceId()
    if (!workspaceId) return
    const runsBefore = runs()?.length ?? 0
    await createPostFn({
      data: {
        workspaceId,
        author: { displayName: 'Threadplane Demo' },
        content: 'Simulated agent request',
      },
    })
    const latestChat = await listChatFn({ data: { workspaceId } })
    const postId = latestChat?.at(-1)?.id
    await requestRunFn({
      data: {
        workspaceId,
        postId,
        agentId: 'simulated-agent',
        agentName: 'Simulated Agent',
        requestedBy: { type: 'user', displayName: 'Threadplane User' },
      },
    })
    if (postId) {
      await replyToPostFn({
        data: {
          workspaceId,
          parentPostId: postId,
          author: { displayName: 'Simulated Agent' },
          content: 'I found the issue.',
        },
      })
    }
    const nextRun = runs()?.at(runsBefore) ?? runs()?.at(-1)
    if (nextRun) setActiveRunId(nextRun.runId)
  }

  const treeNodes = createMemo(() => tree() ?? [])
  const timelineItems = createMemo(() => {
    const currentTimeline = timeline()
    return [
      ...(currentTimeline?.chunks.map((chunk) => ({
        id: chunk.chunkId,
        label: `chunk ${chunk.sequence}: ${chunk.delta}`,
      })) ?? []),
      ...(currentTimeline?.toolCalls.map((toolCall) => ({
        id: toolCall.toolCallId,
        label: `${toolCall.toolName}: ${toolCall.status}`,
      })) ?? []),
    ]
  })

  return (
    <div class="min-h-screen bg-zinc-950 px-4 py-5 text-zinc-100 sm:px-6 lg:px-8">
      <main class="mx-auto grid min-h-[calc(100vh-2.5rem)] w-full max-w-7xl overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/80 shadow-2xl shadow-black/40 lg:grid-cols-[16rem_1fr_21rem]">
        <aside class="border-b border-zinc-800 bg-zinc-950/50 p-4 lg:border-b-0 lg:border-r">
          <p class="text-sm font-medium uppercase tracking-[0.25em] text-cyan-300">
            Threadplane
          </p>
          <h1 class="mt-2 text-2xl font-semibold tracking-tight">
            Reference UI
          </h1>

          <form onSubmit={createWorkspace} class="mt-5 space-y-2">
            <label class="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              New Workspace
              <input
                class="mt-2 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none transition focus:border-cyan-400"
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
              class="w-full rounded-2xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!workspaceDraft().trim() || isCreatingWorkspace()}
            >
              {isCreatingWorkspace() ? 'Creating...' : 'Create Workspace'}
            </button>
          </form>

          <nav class="mt-5 space-y-2" aria-label="Workspaces">
            <For each={workspaces() ?? []}>
              {(workspace) => (
                <button
                  type="button"
                  class={`w-full rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${workspace.id === activeWorkspaceId() ? 'bg-zinc-100 text-zinc-950' : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600'}`}
                  onClick={() => {
                    setActiveWorkspaceId(workspace.id)
                    setSelectedPath(null)
                    setSelectedFilePath(null)
                    setActiveRunId(null)
                  }}
                >
                  {workspace.name}
                </button>
              )}
            </For>
          </nav>
        </aside>

        <section class="flex min-h-[38rem] flex-col border-b border-zinc-800 lg:border-b-0 lg:border-r">
          <header class="border-b border-zinc-800 px-5 py-4 sm:px-6">
            <p class="text-sm text-zinc-400">Active Workspace</p>
            <h2 class="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              {activeWorkspaceName()}
            </h2>
          </header>

          <div class="flex-1 space-y-3 overflow-y-auto px-4 py-5 sm:px-6">
            <Show
              when={(visibleChat().length ?? 0) > 0}
              fallback={
                <div class="rounded-2xl border border-dashed border-zinc-700 p-5 text-sm text-zinc-400">
                  No posts yet. Start the thread below.
                </div>
              }
            >
              <For each={visibleChat()}>
                {(message) => (
                  <article
                    class={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 sm:max-w-[74%] ${message.author.type === 'agent' ? 'border border-cyan-800/70 bg-cyan-950/60 text-cyan-50' : 'ml-auto bg-zinc-100 text-zinc-950'}`}
                  >
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide opacity-70">
                      {message.author.displayName}
                    </div>
                    <p>{message.content}</p>
                  </article>
                )}
              </For>
            </Show>
          </div>

          <form
            onSubmit={createPost}
            class="border-t border-zinc-800 p-4 sm:p-5"
          >
            <div class="flex flex-col gap-3 sm:flex-row">
              <textarea
                class="min-h-24 flex-1 resize-none rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-base outline-none transition focus:border-cyan-400 sm:min-h-12"
                value={messageDraft()}
                onInput={(event) => setMessageDraft(event.currentTarget.value)}
                placeholder="Write a post..."
                disabled={isSendingPost()}
              />
              <button
                type="submit"
                class="rounded-2xl bg-cyan-300 px-5 py-3 font-semibold text-zinc-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50 sm:self-end"
                disabled={!messageDraft().trim() || isSendingPost()}
              >
                {isSendingPost() ? 'Sending...' : 'Post'}
              </button>
            </div>
          </form>
        </section>

        <aside class="flex min-h-[38rem] flex-col gap-4 overflow-y-auto p-4 sm:p-5">
          <section class="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                Filesystem
              </h3>
              <button
                type="button"
                class="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold hover:border-cyan-400 disabled:opacity-50"
                onClick={scanWorkspace}
                disabled={!activeWorkspaceId() || isScanning()}
              >
                {isScanning() ? 'Scanning...' : 'Scan'}
              </button>
            </div>
            <p class="mt-2 text-xs text-zinc-500">
              {status()?.initialized ? 'Initialized' : 'Uninitialized'} ·{' '}
              {status()?.latestScan
                ? `Latest ${status()?.latestScan?.status}`
                : 'No scan yet'}
            </p>
            <div class="mt-3 space-y-1">
              <Show when={selectedPath()}>
                <button
                  type="button"
                  class="text-xs text-cyan-300 hover:underline"
                  onClick={() => {
                    setSelectedPath(null)
                    setSelectedFilePath(null)
                  }}
                >
                  ← Back to root
                </button>
              </Show>
              <For each={treeNodes()}>
                {(node) => (
                  <button
                    type="button"
                    class={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${node.kind === 'directory' ? 'border-zinc-800 bg-zinc-900 text-zinc-200 hover:border-cyan-700' : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600'}`}
                    onClick={() => {
                      if (node.kind === 'directory') {
                        setSelectedPath(node.path)
                        setSelectedFilePath(null)
                      } else {
                        setSelectedFilePath(node.path)
                      }
                    }}
                  >
                    <span>
                      {node.kind === 'directory' ? '📁' : '📄'} {node.name}
                    </span>
                    <span class="text-xs text-zinc-500">
                      {node.sizeBytes ?? ''}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </section>

          <section class="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-zinc-400">
              Preview
            </h3>
            <p class="mt-2 text-xs text-zinc-500">
              {selectedFilePath() ?? 'Select a file to preview.'}
            </p>
            <pre class="mt-3 max-h-64 overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs leading-5 text-zinc-200">
              {previewText() || ''}
            </pre>
          </section>

          <section class="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                Agent Runs
              </h3>
              <button
                type="button"
                class="rounded-xl bg-cyan-300 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-cyan-200 disabled:opacity-50"
                onClick={simulateAgentRun}
                disabled={!activeWorkspaceId()}
              >
                Simulate run
              </button>
            </div>
            <div class="mt-3 space-y-2">
              <For each={runs() ?? []}>
                {(run) => (
                  <button
                    type="button"
                    class={`w-full rounded-xl border px-3 py-2 text-left text-sm ${run.runId === activeRunId() ? 'border-cyan-700 bg-cyan-950/50' : 'border-zinc-800 bg-zinc-900'}`}
                    onClick={() => setActiveRunId(run.runId)}
                  >
                    <div class="font-medium">
                      {run.agentName ?? 'Agent'} · {run.status ?? 'unknown'}
                    </div>
                    <div class="text-xs text-zinc-500">{run.runId}</div>
                  </button>
                )}
              </For>
            </div>
          </section>

          <section class="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-zinc-400">
              Timeline
            </h3>
            <div class="mt-3 space-y-2 text-sm text-zinc-200">
              <For each={timelineItems()}>
                {(item) => (
                  <div class="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
                    {item.label}
                  </div>
                )}
              </For>
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}
