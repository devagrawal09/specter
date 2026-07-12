import { Icon } from './shared/view-helpers'
import { useApprovals } from './approvals'
import { useFilesystem } from './filesystem'
import { useRuns } from './runs'
import { useSpecterCodeSelection } from './selection-context'
import { useSessionChat } from './session-chat'
import { useWorkspaces } from './workspaces'

export function SpecterCodeHeader() {
  const { activeWorkspaceId, activeRunId, activeSessionId } = useSpecterCodeSelection()
  const workspaces = useWorkspaces()
  const filesystem = useFilesystem()
  const runs = useRuns()
  const sessions = useSessionChat()
  const approvals = useApprovals()

  const isRefreshingWorkspace = () =>
    filesystem.tree.loading ||
    Boolean(filesystem.status.loading) ||
    runs.runs.loading ||
    sessions.sessions.loading ||
    sessions.transcript.loading ||
    approvals.pendingPermissions.loading

  async function refreshWorkspacePanels() {
    if (!activeWorkspaceId()) return
    await Promise.all([
      filesystem.refetchTree(),
      filesystem.refetchStatus(),
      runs.refetchRuns(),
      sessions.refetchSessions(),
    ])
    if (activeRunId()) await runs.refetchTimeline()
    if (activeSessionId()) {
      await Promise.all([sessions.refetchTranscript(), approvals.refetchPendingPermissions()])
    }
  }

  return (
    <header class="order-2 flex flex-col gap-3 rounded-[1.75rem] border border-white/10 bg-[#07101c]/80 p-3 shadow-2xl shadow-black/30 ring-1 ring-white/5 backdrop-blur-xl md:flex-row md:items-center md:justify-between xl:order-none xl:col-span-2 xl:col-start-2 xl:row-start-1">
      <div class="flex min-w-0 items-center gap-3 px-1">
        <span class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-emerald-300/30 bg-emerald-300/10 text-emerald-100">
          <Icon name="grid" />
        </span>
        <div class="min-w-0">
          <p class="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.32em] text-emerald-200/75">
            SpecterCode / Sessions
          </p>
          <h1 class="truncate text-xl font-semibold tracking-tight text-white">Specter Code Chat</h1>
        </div>
      </div>

      <nav aria-label="Visual application tabs" class="flex w-full min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-black/20 p-1 md:w-auto md:max-w-xl">
        <button type="button" aria-label="Chat tab (visual only)" class="flex shrink-0 items-center gap-2 rounded-xl bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 shadow-lg shadow-cyan-950/30" title="Chat tab (visual only)">
          <Icon name="chat" />
          <span class="hidden lg:inline">Chat</span>
        </button>
        <button type="button" aria-label="Tasks tab (visual only)" aria-disabled="true" class="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200" title="Tasks tab (visual only)">
          <Icon name="tasks" />
          <span class="hidden lg:inline">Tasks</span>
        </button>
        <button type="button" aria-label="Files tab (visual only)" aria-disabled="true" class="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200" title="Files tab (visual only)">
          <Icon name="calendar" />
          <span class="hidden lg:inline">Files</span>
        </button>
        <button type="button" aria-label="Tools tab (visual only)" aria-disabled="true" class="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200" title="Tools tab (visual only)">
          <Icon name="readme" />
          <span class="hidden lg:inline">Tools</span>
        </button>
      </nav>

      <div class="flex w-full shrink-0 items-center justify-between gap-2 md:w-auto md:justify-start">
        <span class="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-300">
          <span class="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.75)]" />
          {workspaces.workspaces.loading ? 'Sync' : '5s poll'}
        </span>
        <button
          type="button"
          aria-label="Refresh workspace"
          title="Refresh workspace"
          class="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-cyan-300/45 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void refreshWorkspacePanels()}
          disabled={!activeWorkspaceId() || isRefreshingWorkspace()}
        >
          <Icon name="refresh" class={isRefreshingWorkspace() ? 'animate-spin' : ''} />
        </button>
      </div>
    </header>
  )
}

export function WorkspaceStatusStrip() {
  const { selectedFilePath, selectedPath } = useSpecterCodeSelection()
  const workspaces = useWorkspaces()
  const filesystem = useFilesystem()
  const runs = useRuns()
  const sessions = useSessionChat()
  const approvals = useApprovals()

  const isRefreshingWorkspace = () =>
    filesystem.tree.loading ||
    Boolean(filesystem.status.loading) ||
    runs.runs.loading ||
    sessions.sessions.loading ||
    sessions.transcript.loading ||
    approvals.pendingPermissions.loading

  return (
    <aside class="order-6 rounded-[1.75rem] border border-white/10 bg-[#07101c]/90 p-2.5 shadow-2xl shadow-black/35 ring-1 ring-white/5 backdrop-blur-xl xl:order-none xl:col-start-3 xl:row-start-3">
      <div class="grid grid-cols-3 gap-2 text-xs">
        <div class="rounded-xl border border-white/10 bg-black/20 px-2.5 py-1.5">
          <div class="font-mono uppercase tracking-[0.18em] text-slate-500">Sync</div>
          <div class="mt-0.5 truncate font-semibold text-white">{isRefreshingWorkspace() ? 'busy' : 'idle'}</div>
        </div>
        <div class="rounded-xl border border-white/10 bg-black/20 px-2.5 py-1.5">
          <div class="font-mono uppercase tracking-[0.18em] text-slate-500">Scan</div>
          <div class="mt-0.5 truncate font-semibold text-cyan-100">{filesystem.latestScan()?.status ?? 'none'}</div>
        </div>
        <div class="rounded-xl border border-white/10 bg-black/20 px-2.5 py-1.5">
          <div class="font-mono uppercase tracking-[0.18em] text-slate-500">Run</div>
          <div class="mt-0.5 truncate font-semibold text-emerald-100">{runs.activeRun()?.status ?? 'none'}</div>
        </div>
      </div>
      <p class="mt-1.5 truncate px-1 font-mono text-[0.68rem] text-slate-500">
        {selectedFilePath() ?? selectedPath() ?? workspaces.activeWorkspaceName()}
      </p>
    </aside>
  )
}
