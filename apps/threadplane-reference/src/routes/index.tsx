import { createFileRoute } from '@tanstack/solid-router'
import { useServerFn } from '@tanstack/solid-start'
import { For, Show, createEffect, createResource, createSignal } from 'solid-js'

import {
  createWorkspace,
  listWorkspaceMessages,
  listWorkspaces,
  postChatMessage,
} from '../features/chat/server-functions'

export const Route = createFileRoute('/')({ component: Home })

const defaultWorkspaceId = 'workspace-main'

function Home() {
  const [draft, setDraft] = createSignal('')
  const [workspaceDraft, setWorkspaceDraft] = createSignal('')
  const [activeWorkspaceId, setActiveWorkspaceId] =
    createSignal(defaultWorkspaceId)
  const [isSubmitting, setIsSubmitting] = createSignal(false)
  const [isCreatingWorkspace, setIsCreatingWorkspace] = createSignal(false)
  const listWorkspaceItems = useServerFn(listWorkspaces)
  const createWorkspaceOnServer = useServerFn(createWorkspace)
  const listMessages = useServerFn(listWorkspaceMessages)
  const postMessage = useServerFn(postChatMessage)

  const [workspaces, { refetch: refetchWorkspaces }] = createResource(() =>
    listWorkspaceItems(),
  )
  const [messages, { refetch: refetchMessages }] = createResource(
    activeWorkspaceId,
    (workspaceId) => listMessages({ data: { workspaceId } }),
  )

  createEffect(() => {
    const items = workspaces()

    if (
      items?.length &&
      !items.some((workspace) => workspace.id === activeWorkspaceId())
    ) {
      setActiveWorkspaceId(items[0].id)
    }
  })

  const activeWorkspaceName = () =>
    workspaces()?.find((workspace) => workspace.id === activeWorkspaceId())
      ?.name ?? 'Workspace Chat'

  async function submitWorkspace(event: SubmitEvent) {
    event.preventDefault()

    const name = workspaceDraft().trim()
    if (!name || isCreatingWorkspace()) return

    setIsCreatingWorkspace(true)

    try {
      const nextWorkspaces = await createWorkspaceOnServer({ data: { name } })
      setWorkspaceDraft('')
      await refetchWorkspaces()

      const createdWorkspace = nextWorkspaces.at(-1)
      if (createdWorkspace) setActiveWorkspaceId(createdWorkspace.id)
    } finally {
      setIsCreatingWorkspace(false)
    }
  }

  async function submitMessage(event: SubmitEvent) {
    event.preventDefault()

    const content = draft().trim()
    if (!content || isSubmitting()) return

    setIsSubmitting(true)

    try {
      await postMessage({
        data: {
          workspaceId: activeWorkspaceId(),
          authorName: 'Threadplane User',
          content,
        },
      })
      setDraft('')
      await refetchMessages()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div class="min-h-screen bg-zinc-950 px-4 py-5 text-zinc-100 sm:px-6 lg:px-8">
      <main class="mx-auto grid min-h-[calc(100vh-2.5rem)] w-full max-w-6xl overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/80 shadow-2xl shadow-black/40 lg:grid-cols-[18rem_1fr]">
        <aside class="border-b border-zinc-800 bg-zinc-950/50 p-4 lg:border-b-0 lg:border-r">
          <p class="text-sm font-medium uppercase tracking-[0.25em] text-cyan-300">
            Threadplane
          </p>
          <h1 class="mt-2 text-2xl font-semibold tracking-tight">
            Workspace Chat
          </h1>

          <form onSubmit={submitWorkspace} class="mt-5 space-y-2">
            <label class="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              New Workspace
            </label>
            <input
              class="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400"
              value={workspaceDraft()}
              onInput={(event) => setWorkspaceDraft(event.currentTarget.value)}
              placeholder="Workspace name"
              disabled={isCreatingWorkspace()}
            />
            <button
              type="submit"
              class="w-full rounded-2xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!workspaceDraft().trim() || isCreatingWorkspace()}
            >
              {isCreatingWorkspace() ? 'Creating...' : 'Create Workspace'}
            </button>
          </form>

          <nav class="mt-5 space-y-2" aria-label="Workspaces">
            <For each={workspaces()}>
              {(workspace) => (
                <button
                  type="button"
                  class={`w-full rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                    workspace.id === activeWorkspaceId()
                      ? 'bg-zinc-100 text-zinc-950'
                      : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600'
                  }`}
                  onClick={() => setActiveWorkspaceId(workspace.id)}
                >
                  {workspace.name}
                </button>
              )}
            </For>
          </nav>
        </aside>

        <div class="flex min-h-[38rem] flex-col">
          <header class="border-b border-zinc-800 px-5 py-4 sm:px-6">
            <p class="text-sm text-zinc-400">Active Workspace</p>
            <h2 class="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              {activeWorkspaceName()}
            </h2>
            <p class="mt-2 text-sm text-zinc-400">
              Mention @specter to trigger the deterministic agent reply.
            </p>
          </header>

          <section class="flex-1 space-y-3 overflow-y-auto px-4 py-5 sm:px-6">
            <Show
              when={!messages.loading && (messages()?.length ?? 0) > 0}
              fallback={
                <div class="rounded-2xl border border-dashed border-zinc-700 p-5 text-sm text-zinc-400">
                  No messages yet. Start with "Can @specter help?"
                </div>
              }
            >
              <For each={messages()}>
                {(message) => (
                  <article
                    class={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 sm:max-w-[74%] ${
                      message.author.type === 'agent'
                        ? 'border border-cyan-800/70 bg-cyan-950/60 text-cyan-50'
                        : 'ml-auto bg-zinc-100 text-zinc-950'
                    }`}
                  >
                    <div class="mb-1 text-xs font-semibold uppercase tracking-wide opacity-70">
                      {message.author.displayName}
                    </div>
                    <p>{message.content}</p>
                  </article>
                )}
              </For>
            </Show>
          </section>

          <form
            onSubmit={submitMessage}
            class="border-t border-zinc-800 p-4 sm:p-5"
          >
            <div class="flex flex-col gap-3 sm:flex-row">
              <textarea
                class="min-h-24 flex-1 resize-none rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-base text-zinc-100 outline-none transition focus:border-cyan-400 sm:min-h-12"
                value={draft()}
                onInput={(event) => setDraft(event.currentTarget.value)}
                placeholder="Write a message..."
                disabled={isSubmitting()}
              />
              <button
                type="submit"
                class="rounded-2xl bg-cyan-300 px-5 py-3 font-semibold text-zinc-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50 sm:self-end"
                disabled={!draft().trim() || isSubmitting()}
              >
                {isSubmitting() ? 'Sending...' : 'Send'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
