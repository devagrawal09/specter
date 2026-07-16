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
  createSpecterCodeWorkspace,
  listSpecterCodeWorkspaces,
  requestSpecterCodeFilesystemScan,
} from '../client-functions'
import { createPollingResource } from '../../../lib/create-polling-resource'
import { useSpecterCodeSelection } from './selection-context'
import {
  Icon,
  POLL_INTERVAL_MS,
  initials,
  shortId,
  type ProviderProps,
} from './shared/view-helpers'

function createWorkspaceModel() {
  const [workspaceDraft, setWorkspaceDraft] = createSignal('')
  const [workspaceFilter, setWorkspaceFilter] = createSignal('')
  const [isCreatingWorkspace, setIsCreatingWorkspace] = createSignal(false)
  const {
    activeWorkspaceId,
    selectWorkspace,
    setSelectedPath,
    setSelectedFilePath,
    setActiveRunId,
  } = useSpecterCodeSelection()

  const listWorkspacesFn = listSpecterCodeWorkspaces
  const createWorkspaceFn = createSpecterCodeWorkspace
  const requestScanFn = requestSpecterCodeFilesystemScan

  const [workspaces, { refetch: refetchWorkspaces }] = createPollingResource(
    () => true,
    () => listWorkspacesFn(),
    { intervalMs: POLL_INTERVAL_MS, initialValue: [] },
  )

  createEffect(
    on(workspaces, (items) => {
      if (!items?.length) {
        if (activeWorkspaceId()) {
          void startTransition(() => {
            selectWorkspace(null)
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
        setWorkspaceDraft('')
      }
    } finally {
      setIsCreatingWorkspace(false)
    }
  }

  return {
    workspaceDraft,
    setWorkspaceDraft,
    workspaceFilter,
    setWorkspaceFilter,
    isCreatingWorkspace,
    workspaces,
    refetchWorkspaces,
    allWorkspaces,
    filteredWorkspaces,
    activeWorkspace,
    activeWorkspaceName,
    createWorkspace,
  }
}

type WorkspaceContextValue = ReturnType<typeof createWorkspaceModel>
const WorkspaceContext = createContext<WorkspaceContextValue>()

export function WorkspaceProvider(props: ProviderProps) {
  const value = createWorkspaceModel()
  return (
    <WorkspaceContext.Provider value={value}>
      {props.children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspaces() {
  const value = useContext(WorkspaceContext)
  if (!value)
    throw new Error('useWorkspaces must be used inside WorkspaceProvider')
  return value
}

export function WorkspaceSidebar() {
  const { activeWorkspaceId, selectWorkspace } = useSpecterCodeSelection()
  const workspaces = useWorkspaces()

  return (
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
                SpecterCode
              </h2>
            </div>
          </div>
          <button
            type="button"
            aria-label="Refresh workspaces"
            title="Refresh workspaces"
            class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-cyan-300/45 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void workspaces.refetchWorkspaces()}
            disabled={workspaces.workspaces.loading}
          >
            <Icon
              name="refresh"
              class={workspaces.workspaces.loading ? 'animate-spin' : ''}
            />
          </button>
        </div>

        <form onSubmit={workspaces.createWorkspace} class="mt-5 space-y-2">
          <div>
            <label
              for="specterCode-workspace-name"
              class="block font-mono text-[0.66rem] font-semibold uppercase tracking-[0.24em] text-slate-500"
            >
              New Workspace
            </label>
            <div class="mt-2 flex gap-2">
              <input
                id="specterCode-workspace-name"
                class="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-60"
                value={workspaces.workspaceDraft()}
                onInput={(event) =>
                  workspaces.setWorkspaceDraft(event.currentTarget.value)
                }
                placeholder="Workspace name"
                disabled={workspaces.isCreatingWorkspace()}
              />
              <button
                type="submit"
                aria-label="Create Workspace"
                title="Create Workspace"
                class="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-cyan-300 text-lg font-semibold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  !workspaces.workspaceDraft().trim() ||
                  workspaces.isCreatingWorkspace()
                }
              >
                <Icon
                  name={workspaces.isCreatingWorkspace() ? 'refresh' : 'plus'}
                  class={workspaces.isCreatingWorkspace() ? 'animate-spin' : ''}
                />
              </button>
            </div>
          </div>
        </form>

        <div class="mt-4">
          <label
            for="specterCode-workspace-filter"
            class="block font-mono text-[0.66rem] font-semibold uppercase tracking-[0.24em] text-slate-500"
          >
            Find Workspace
          </label>
          <div class="mt-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 transition focus-within:border-emerald-300/50 focus-within:ring-2 focus-within:ring-emerald-300/10">
            <Icon name="search" class="text-slate-500" />
            <input
              id="specterCode-workspace-filter"
              class="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
              value={workspaces.workspaceFilter()}
              onInput={(event) =>
                workspaces.setWorkspaceFilter(event.currentTarget.value)
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
              {workspaces.allWorkspaces().length}
            </div>
          </div>
          <div class="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <div class="font-mono uppercase tracking-[0.18em] text-slate-500">
              Link
            </div>
            <div class="mt-1 font-semibold text-emerald-200">
              {workspaces.workspaces.loading ? 'Sync' : 'Idle'}
            </div>
          </div>
        </div>
      </div>

      <nav
        class="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
        aria-label="Workspaces"
      >
        <Show
          when={workspaces.allWorkspaces().length > 0}
          fallback={
            <div class="rounded-2xl border border-dashed border-cyan-100/15 bg-white/[0.02] p-4 text-sm leading-6 text-slate-400">
              Create a workspace to anchor chat, scans, previews, and runs.
            </div>
          }
        >
          <Show
            when={workspaces.filteredWorkspaces().length > 0}
            fallback={
              <div class="rounded-2xl border border-dashed border-cyan-100/15 bg-white/[0.02] p-4 text-sm text-slate-400">
                No workspaces match “{workspaces.workspaceFilter().trim()}”.
              </div>
            }
          >
            <For each={workspaces.filteredWorkspaces()}>
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
  )
}
