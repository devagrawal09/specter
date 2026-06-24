import { ActivityRail } from './activity-rail'
import { ApprovalsProvider } from './approvals'
import { SpecterCodeHeader, WorkspaceStatusStrip } from './app-chrome'
import { FilesystemProvider } from './filesystem'
import { RunsProvider } from './runs'
import { SpecterCodeSelectionProvider } from './selection-context'
import { SessionChatPanel, SessionChatProvider, SessionPromptComposer } from './session-chat'
import { WorkspaceProvider, WorkspaceSidebar } from './workspaces'

function SpecterCodeSurface() {
  return (
    <div class="min-h-screen bg-[#05070d] text-slate-100">
      <div class="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_8%_8%,rgba(34,211,238,0.16),transparent_30%),radial-gradient(circle_at_88%_12%,rgba(16,185,129,0.13),transparent_26%),linear-gradient(135deg,#030712_0%,#07111f_50%,#0b1020_100%)]" />
      <div class="pointer-events-none fixed inset-0 opacity-[0.13] [background-image:linear-gradient(rgba(148,163,184,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.12)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div class="pointer-events-none fixed inset-0 opacity-[0.055] [background-image:linear-gradient(rgba(125,211,252,0.22)_1px,transparent_1px)] [background-size:100%_4px]" />

      <main class="relative mx-auto grid min-h-screen w-full max-w-[1680px] auto-rows-min grid-cols-1 gap-3 p-3 md:p-4 xl:h-screen xl:auto-rows-auto xl:grid-cols-[18.5rem_minmax(0,1fr)_25rem] xl:grid-rows-[auto_minmax(0,1fr)_auto] xl:overflow-hidden">
        <WorkspaceSidebar />
        <SpecterCodeHeader />
        <SessionChatPanel />
        <SessionPromptComposer />
        <ActivityRail />
        <WorkspaceStatusStrip />
      </main>
    </div>
  )
}

export function SpecterCodeShell() {
  return (
    <SpecterCodeSelectionProvider>
      <WorkspaceProvider>
        <SessionChatProvider>
          <FilesystemProvider>
            <RunsProvider>
              <ApprovalsProvider>
                <SpecterCodeSurface />
              </ApprovalsProvider>
            </RunsProvider>
          </FilesystemProvider>
        </SessionChatProvider>
      </WorkspaceProvider>
    </SpecterCodeSelectionProvider>
  )
}
