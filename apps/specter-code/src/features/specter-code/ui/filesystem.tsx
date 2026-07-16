import { useServerFn } from '@tanstack/solid-start'
import {
  For,
  Show,
  createContext,
  createMemo,
  createResource,
  createSignal,
  useContext,
} from 'solid-js'

import {
  getSpecterCodeFilesystemStatus,
  listSpecterCodeFilesystemTree,
  requestSpecterCodeFilesystemScan,
} from '../client-functions'
import { readSpecterCodeWorkspaceTextFile } from '../server-functions'
import { createPollingResource } from '../../../lib/create-polling-resource'
import { useSpecterCodeSelection } from './selection-context'
import {
  Icon,
  POLL_INTERVAL_MS,
  SPECTER_CODE_USER_DISPLAY_NAME,
  buildPathSegments,
  fileNameOf,
  formatBytes,
  formatError,
  formatRequester,
  formatScanReason,
  parentPathOf,
  scanStatusTone,
  scanSummary,
  type ProviderProps,
} from './shared/view-helpers'

function createFilesystemModel() {
  const [isScanning, setIsScanning] = createSignal(false)
  const { activeWorkspaceId, selectedPath, selectedFilePath } =
    useSpecterCodeSelection()

  const listTreeFn = listSpecterCodeFilesystemTree
  const listStatusFn = getSpecterCodeFilesystemStatus
  const readFileFn = useServerFn(readSpecterCodeWorkspaceTextFile)
  const requestScanFn = requestSpecterCodeFilesystemScan

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

  const [previewText] = createResource(selectedFilePath, async (filePath) => {
    const workspaceId = activeWorkspaceId()
    if (!workspaceId || !filePath) return ''
    return readFileFn({ data: { workspaceId, path: filePath } })
  })

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

  async function scanWorkspace() {
    const workspaceId = activeWorkspaceId()
    if (!workspaceId || isScanning()) return
    setIsScanning(true)
    try {
      await requestScanFn({
        data: {
          workspaceId,
          scanId: crypto.randomUUID(),
          reason: 'userRequested',
          requestedBy: {
            type: 'user',
            displayName: SPECTER_CODE_USER_DISPLAY_NAME,
          },
        },
      })
      await Promise.all([refetchStatus(), refetchTree()])
    } finally {
      setIsScanning(false)
    }
  }

  return {
    isScanning,
    tree,
    refetchTree,
    status,
    refetchStatus,
    previewText,
    treeNodes,
    visibleFiles,
    visibleDirectories,
    latestScan,
    selectedPathSegments,
    previewErrorMessage,
    scanWorkspace,
  }
}

type FilesystemContextValue = ReturnType<typeof createFilesystemModel>
const FilesystemContext = createContext<FilesystemContextValue>()

export function FilesystemProvider(props: ProviderProps) {
  const value = createFilesystemModel()
  return (
    <FilesystemContext.Provider value={value}>
      {props.children}
    </FilesystemContext.Provider>
  )
}

export function useFilesystem() {
  const value = useContext(FilesystemContext)
  if (!value)
    throw new Error('useFilesystem must be used inside FilesystemProvider')
  return value
}

export function FilesystemPanel() {
  const {
    activeWorkspaceId,
    selectedPath,
    setSelectedPath,
    selectedFilePath,
    setSelectedFilePath,
  } = useSpecterCodeSelection()
  const filesystem = useFilesystem()

  return (
    <section class="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-cyan-100/10 bg-slate-950/45 p-3 shadow-inner shadow-black/20">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h3 class="flex items-center gap-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-slate-300">
            <Icon name="folder" class="text-cyan-200" />
            Files
          </h3>
          <p class="mt-0.5 truncate text-[0.68rem] text-slate-500">
            {filesystem.visibleDirectories()} folders ·{' '}
            {filesystem.visibleFiles()} files
          </p>
        </div>
        <span
          class={`shrink-0 rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold ${scanStatusTone(filesystem.latestScan()?.status)}`}
        >
          {filesystem.status()?.initialized ? 'Init' : 'Cold'}
        </span>
      </div>

      <div
        class="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-2.5 py-1.5"
        title={
          filesystem.latestScan()
            ? `${formatScanReason(filesystem.latestScan()?.reason)} · ${formatRequester(filesystem.latestScan()?.requestedBy)}`
            : undefined
        }
      >
        <span class="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.7)]" />
        <p class="truncate text-xs text-slate-400">
          Latest {filesystem.latestScan()?.status ?? 'scan pending'} ·{' '}
          {scanSummary(filesystem.latestScan())}
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
          <For each={filesystem.selectedPathSegments()}>
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
            when={
              !(filesystem.tree.loading && filesystem.treeNodes().length === 0)
            }
            fallback={
              <div class="space-y-1.5">
                <div class="h-9 animate-pulse rounded-xl bg-white/5" />
                <div class="h-9 animate-pulse rounded-xl bg-white/5" />
              </div>
            }
          >
            <Show
              when={filesystem.treeNodes().length > 0}
              fallback={
                <div class="rounded-xl border border-dashed border-cyan-100/15 p-3 text-xs leading-5 text-slate-400">
                  Empty folder, or scan has not populated the tree.
                </div>
              }
            >
              <div class="space-y-1.5">
                <For each={filesystem.treeNodes()}>
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
                            name={node.kind === 'directory' ? 'folder' : 'file'}
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
  )
}

export function FilePreviewPanel() {
  const { selectedFilePath } = useSpecterCodeSelection()
  const filesystem = useFilesystem()

  return (
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
              Select a file to preview text. Binary, symlink, and escaping paths
              stay blocked.
            </div>
          }
        >
          <Show
            when={!filesystem.previewText.loading}
            fallback={
              <div class="h-12 animate-pulse rounded-xl border border-white/10 bg-white/5" />
            }
          >
            <Show
              when={!filesystem.previewErrorMessage()}
              fallback={
                <div class="rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-xs leading-5 text-rose-100">
                  <div class="font-semibold">Preview unavailable</div>
                  <p class="mt-1 text-rose-100/80">
                    {filesystem.previewErrorMessage()}
                  </p>
                </div>
              }
            >
              <Show
                when={(filesystem.previewText() ?? '').length > 0}
                fallback={
                  <div class="rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-slate-400">
                    File is empty.
                  </div>
                }
              >
                <pre class="m-0 max-h-28 overflow-auto rounded-xl border border-emerald-300/10 bg-black/35 p-3 font-mono text-[0.68rem] leading-5 text-slate-200 shadow-inner shadow-black/30">
                  <code>{filesystem.previewText()}</code>
                </pre>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
    </section>
  )
}
