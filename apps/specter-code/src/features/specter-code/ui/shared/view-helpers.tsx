import type { JSX } from 'solid-js'

export const POLL_INTERVAL_MS = 5000
export const SPECTER_CODE_USER_DISPLAY_NAME = 'SpecterCode User'

export type PathSegment = {
  label: string
  path: string
}

export type RequestedBy =
  | { type: 'user'; userId?: string; displayName: string }
  | { type: 'agent'; agentId: string; displayName: string }
  | { type: 'system' }

export type ScanLike = {
  status: 'requested' | 'running' | 'completed' | 'failed'
  reason: 'workspaceCreated' | 'userRequested' | 'agentToolChanged'
  requestedBy: RequestedBy
  discoveredNodeCount?: number
  changedNodeCount?: number
  deletedNodeCount?: number
  error?: string
}

export function buildPathSegments(filePath: string | null): PathSegment[] {
  if (!filePath) return []
  const parts = filePath.split('/').filter(Boolean)
  return parts.map((label, index) => ({
    label,
    path: parts.slice(0, index + 1).join('/'),
  }))
}

export function parentPathOf(filePath: string | null) {
  if (!filePath) return null
  const parts = filePath.split('/').filter(Boolean)
  if (parts.length <= 1) return null
  return parts.slice(0, -1).join('/')
}

export function fileNameOf(filePath: string | null) {
  if (!filePath) return ''
  return filePath.split('/').filter(Boolean).at(-1) ?? filePath
}

export function initials(name: string) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  return letters || 'TP'
}

export function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`
}

export function formatBytes(sizeBytes: number | null | undefined) {
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

export function formatRequester(requestedBy: RequestedBy | undefined) {
  if (!requestedBy) return 'Unknown requester'
  if (requestedBy.type === 'system') return 'System'
  return requestedBy.displayName
}

export function formatScanReason(reason: ScanLike['reason'] | undefined) {
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

export function scanStatusTone(status: ScanLike['status'] | undefined) {
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

export function runStatusTone(status: string | undefined) {
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

export function scanSummary(scan: ScanLike | null | undefined) {
  if (!scan) return 'No scan yet'
  if (scan.status === 'completed') {
    return `${scan.discoveredNodeCount ?? 0} discovered · ${scan.changedNodeCount ?? 0} changed · ${scan.deletedNodeCount ?? 0} deleted`
  }
  if (scan.status === 'failed') return scan.error ?? 'Scan failed'
  if (scan.status === 'running') return 'Scanning workspace files'
  return 'Queued for scanning'
}

export function formatError(cause: unknown) {
  if (!cause) return null
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string') return cause
  return 'Something went wrong.'
}

export function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

export function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

const iconGlyphs = {
  activity: '≋',
  bot: '✦',
  calendar: '◫',
  chat: '◌',
  file: '∷',
  folder: '▣',
  grid: '⌗',
  play: '▶',
  plus: '+',
  readme: '◇',
  refresh: '↻',
  scan: '◈',
  search: '⌕',
  send: '↵',
  status: '●',
  tasks: '☷',
  terminal: '⌁',
  up: '↑',
  workspace: '◍',
} as const

type IconName = keyof typeof iconGlyphs

export function Icon(props: { name: IconName; class?: string }) {
  return (
    <span
      aria-hidden="true"
      class={`inline-flex select-none items-center justify-center font-mono leading-none ${props.class ?? ''}`}
    >
      {iconGlyphs[props.name]}
    </span>
  )
}

export type ProviderProps = { children: JSX.Element }
