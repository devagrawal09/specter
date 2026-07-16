import { useServerFn } from '@tanstack/solid-start'
import { For, Show, createEffect, createMemo, createSignal, on } from 'solid-js'

import {
  getSpecterCodeWorkspaceDiff,
  revertSpecterCodeWorkspaceChanges,
} from '../server-functions'
import { useSpecterCodeSelection } from './selection-context'
import { Icon } from './shared/view-helpers'

type WorkspaceDiffState = {
  workspaceRoot: string
  status: {
    clean: boolean
    entries: Array<{ path: string; index: string; workingTree: string }>
  }
  diff: { patch: string; staged: boolean; path?: string }
}

export function WorkspaceDiffPanel() {
  const { activeWorkspaceId } = useSpecterCodeSelection()
  const getWorkspaceDiffFn = useServerFn(getSpecterCodeWorkspaceDiff)
  const revertWorkspaceChangesFn = useServerFn(
    revertSpecterCodeWorkspaceChanges,
  )
  const [workspaceDiff, setWorkspaceDiff] =
    createSignal<WorkspaceDiffState | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [isRefreshing, setIsRefreshing] = createSignal(false)
  const [isReverting, setIsReverting] = createSignal(false)

  const changedPaths = createMemo(() => [
    ...new Set(
      (workspaceDiff()?.status.entries ?? []).map((entry) => entry.path),
    ),
  ])
  const patchPreview = createMemo(
    () => workspaceDiff()?.diff.patch.trim() ?? '',
  )

  async function refreshWorkspaceDiff() {
    const workspaceId = activeWorkspaceId()
    if (!workspaceId || isRefreshing()) return
    setIsRefreshing(true)
    setError(null)
    try {
      const nextDiff = await getWorkspaceDiffFn({ data: { workspaceId } })
      setWorkspaceDiff(nextDiff as WorkspaceDiffState)
    } catch (cause) {
      setWorkspaceDiff(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setIsRefreshing(false)
    }
  }

  async function revertChangedFiles() {
    const workspaceId = activeWorkspaceId()
    const paths = changedPaths()
    if (!workspaceId || paths.length === 0 || isReverting()) return
    setIsReverting(true)
    setError(null)
    try {
      await revertWorkspaceChangesFn({ data: { workspaceId, paths } })
      await refreshWorkspaceDiff()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setIsReverting(false)
    }
  }

  createEffect(
    on(activeWorkspaceId, (workspaceId) => {
      setWorkspaceDiff(null)
      setError(null)
      if (workspaceId) void refreshWorkspaceDiff()
    }),
  )

  return (
    <section
      aria-label="Workspace diff"
      class="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-violet-100/10 bg-slate-950/45 p-3 shadow-inner shadow-black/20"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h3 class="flex items-center gap-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-slate-300">
            <Icon name="status" class="text-violet-200" />
            Workspace diff
          </h3>
          <p class="mt-0.5 truncate text-[0.68rem] text-slate-500">
            {changedPaths().length > 0
              ? `${changedPaths().length} changed`
              : 'Git changes + revert'}
          </p>
        </div>
        <div class="flex shrink-0 gap-1.5">
          <button
            type="button"
            aria-label="Refresh diff"
            title="Refresh diff"
            class="rounded-lg border border-violet-300/30 bg-violet-300/10 px-2 py-1 text-[0.68rem] font-semibold text-violet-100 transition hover:border-violet-200/50 hover:bg-violet-300/20 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void refreshWorkspaceDiff()}
            disabled={!activeWorkspaceId() || isRefreshing()}
          >
            {isRefreshing() ? 'Refreshing' : 'Refresh'}
          </button>
          <button
            type="button"
            aria-label="Revert changed files"
            title="Revert changed files"
            class="rounded-lg bg-rose-300 px-2 py-1 text-[0.68rem] font-semibold text-slate-950 transition hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void revertChangedFiles()}
            disabled={
              !activeWorkspaceId() ||
              changedPaths().length === 0 ||
              isReverting()
            }
          >
            {isReverting() ? 'Reverting' : 'Revert'}
          </button>
        </div>
      </div>

      <div class="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
        <Show
          when={activeWorkspaceId()}
          fallback={
            <div class="rounded-xl border border-dashed border-violet-100/15 p-3 text-xs leading-5 text-slate-400">
              Select a workspace to inspect Git diff output.
            </div>
          }
        >
          <Show
            when={!error()}
            fallback={
              <div class="rounded-xl border border-rose-300/20 bg-rose-300/10 p-3 text-xs leading-5 text-rose-100">
                Diff unavailable: {error()}
              </div>
            }
          >
            <Show
              when={changedPaths().length > 0}
              fallback={
                <div class="rounded-xl border border-dashed border-violet-100/15 p-3 text-xs leading-5 text-slate-400">
                  No workspace changes
                </div>
              }
            >
              <div class="space-y-2">
                <div class="space-y-1">
                  <For each={changedPaths()}>
                    {(filePath) => (
                      <div class="rounded-lg border border-violet-300/20 bg-violet-300/10 px-2 py-1 font-mono text-[0.68rem] text-violet-50">
                        {filePath}
                      </div>
                    )}
                  </For>
                </div>
                <Show when={patchPreview().length > 0}>
                  <pre class="max-h-28 overflow-auto rounded-xl border border-white/10 bg-black/35 p-2 font-mono text-[0.65rem] leading-4 text-slate-200">
                    {patchPreview()}
                  </pre>
                </Show>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </section>
  )
}
