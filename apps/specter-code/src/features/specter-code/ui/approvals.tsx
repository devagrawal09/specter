import { useServerFn } from '@tanstack/solid-start'
import { For, Show, createContext, createMemo, useContext } from 'solid-js'

import {
  listSpecterCodePendingPermissions,
  replySpecterCodeToolApproval,
} from '../server-functions'
import { createPollingResource } from '../../../lib/create-polling-resource'
import { useSpecterCodeSelection } from './selection-context'
import {
  Icon,
  POLL_INTERVAL_MS,
  SPECTER_CODE_USER_DISPLAY_NAME,
  type ProviderProps,
} from './shared/view-helpers'

function createApprovalsModel() {
  const { activeSessionId } = useSpecterCodeSelection()
  const listPendingPermissionsFn = useServerFn(listSpecterCodePendingPermissions)
  const replyToolApprovalFn = useServerFn(replySpecterCodeToolApproval)

  const [pendingPermissions, { refetch: refetchPendingPermissions }] = createPollingResource(
    () => activeSessionId(),
    (sessionId) => listPendingPermissionsFn({ data: { sessionId } }),
    { intervalMs: POLL_INTERVAL_MS, initialValue: [] },
  )

  const pendingPermissionList = createMemo(() => pendingPermissions() ?? [])

  async function replyToPendingPermission(requestId: string, action: 'allow' | 'deny') {
    const sessionId = activeSessionId()
    if (!sessionId) return
    await replyToolApprovalFn({
      data: {
        requestId,
        sessionId,
        action,
        repliedBy: { displayName: SPECTER_CODE_USER_DISPLAY_NAME },
      },
    })
    await refetchPendingPermissions()
  }

  return {
    pendingPermissions,
    refetchPendingPermissions,
    pendingPermissionList,
    replyToPendingPermission,
  }
}

type ApprovalsContextValue = ReturnType<typeof createApprovalsModel>
const ApprovalsContext = createContext<ApprovalsContextValue>()

export function ApprovalsProvider(props: ProviderProps) {
  const value = createApprovalsModel()
  return <ApprovalsContext.Provider value={value}>{props.children}</ApprovalsContext.Provider>
}

export function useApprovals() {
  const value = useContext(ApprovalsContext)
  if (!value) throw new Error('useApprovals must be used inside ApprovalsProvider')
  return value
}

export function PendingApprovalsPanel() {
  const { activeSessionId } = useSpecterCodeSelection()
  const approvals = useApprovals()

  return (
    <section
      role="region"
      aria-label="Pending approvals"
      class="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-amber-100/10 bg-slate-950/45 p-3 shadow-inner shadow-black/20"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h3 class="flex items-center gap-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-slate-300">
            <Icon name="tasks" class="text-amber-200" />
            Pending approvals
          </h3>
          <p class="mt-0.5 truncate text-[0.68rem] text-slate-500">Tool execution decisions</p>
        </div>
        <span class="shrink-0 rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-[0.68rem] font-semibold text-amber-100">
          {approvals.pendingPermissionList().length}
        </span>
      </div>

      <div class="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
        <Show
          when={activeSessionId()}
          fallback={<div class="rounded-xl border border-dashed border-amber-100/15 p-3 text-xs leading-5 text-slate-400">Select a session to review gated tool calls.</div>}
        >
          <Show
            when={approvals.pendingPermissionList().length > 0}
            fallback={<div class="rounded-xl border border-dashed border-amber-100/15 p-3 text-xs leading-5 text-slate-400">No tools are waiting for approval.</div>}
          >
            <div class="space-y-1.5">
              <For each={approvals.pendingPermissionList()}>
                {(request) => (
                  <article class="rounded-xl border border-amber-300/20 bg-amber-300/10 p-2.5">
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <div class="truncate text-xs font-semibold text-amber-50">{request.toolName} · {request.permission}</div>
                        <p class="mt-0.5 truncate font-mono text-[0.68rem] text-amber-100/80">{request.target}</p>
                        <Show when={request.reason}><p class="mt-1 text-[0.68rem] leading-4 text-slate-400">{request.reason}</p></Show>
                      </div>
                    </div>
                    <div class="mt-2 flex gap-1.5">
                      <button
                        type="button"
                        aria-label={`Allow ${request.permission}`}
                        class="rounded-lg bg-emerald-300 px-2 py-1 text-[0.68rem] font-semibold text-slate-950 transition hover:bg-emerald-200"
                        onClick={() => void approvals.replyToPendingPermission(request.requestId, 'allow')}
                      >
                        Allow
                      </button>
                      <button
                        type="button"
                        aria-label={`Deny ${request.permission}`}
                        class="rounded-lg border border-rose-300/30 bg-rose-300/10 px-2 py-1 text-[0.68rem] font-semibold text-rose-100 transition hover:border-rose-200/50 hover:bg-rose-300/20"
                        onClick={() => void approvals.replyToPendingPermission(request.requestId, 'deny')}
                      >
                        Deny
                      </button>
                    </div>
                  </article>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </section>
  )
}
