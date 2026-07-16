import { PendingApprovalsPanel } from './approvals'
import { WorkspaceDiffPanel } from './diff'
import { FilePreviewPanel, FilesystemPanel, useFilesystem } from './filesystem'
import { AgentRunsPanel, AgentTimelinePanel, useRuns } from './runs'
import { useSpecterCodeSelection } from './selection-context'
import { Icon } from './shared/view-helpers'

export function ActivityRail() {
  const { activeWorkspaceId } = useSpecterCodeSelection()
  const filesystem = useFilesystem()
  const runs = useRuns()

  return (
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
              title={filesystem.isScanning() ? 'Scanning...' : 'Scan'}
              class="grid h-9 w-9 place-items-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-100 transition hover:border-cyan-200/60 hover:bg-cyan-300/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void filesystem.scanWorkspace()}
              disabled={!activeWorkspaceId() || filesystem.isScanning()}
            >
              <Icon
                name="scan"
                class={filesystem.isScanning() ? 'animate-pulse' : ''}
              />
            </button>
            <button
              type="button"
              aria-label="Simulate run"
              title={runs.isRequestingRun() ? 'Starting...' : 'Simulate run'}
              class="grid h-9 w-9 place-items-center rounded-2xl bg-emerald-300 text-slate-950 shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void runs.simulateAgentRun()}
              disabled={!activeWorkspaceId() || runs.isRequestingRun()}
            >
              <Icon
                name={runs.isRequestingRun() ? 'refresh' : 'play'}
                class={runs.isRequestingRun() ? 'animate-spin' : ''}
              />
            </button>
          </div>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-2.5">
        <div class="grid min-h-full grid-rows-[1.05fr_0.68fr_minmax(9rem,auto)_minmax(10rem,auto)_1fr] gap-2.5">
          <FilesystemPanel />
          <FilePreviewPanel />
          <WorkspaceDiffPanel />
          <PendingApprovalsPanel />
          <div class="grid min-h-0 grid-cols-1 gap-2.5 sm:grid-cols-2">
            <AgentRunsPanel />
            <AgentTimelinePanel />
          </div>
        </div>
      </div>
    </aside>
  )
}
