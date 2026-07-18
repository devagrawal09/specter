import { activeElapsedMs, loadState, type Clock } from './runner.js'
import { terminateProcessTree } from './process-tree.js'

export interface ActiveLimitSupervisorOptions {
  clock?: Clock
  pollIntervalMs?: number
  sleep?: (milliseconds: number) => Promise<void>
  terminate?: (pid: number, signal: NodeJS.Signals) => void
}

export interface ActiveLimitSupervisorResult {
  terminated: boolean
  activeElapsedMs: number
  activeLimitMs: number
}

const systemClock: Clock = { now: () => new Date() }

export async function superviseActiveLimit(
  attemptDirectory: string,
  processGroupLeaderPid: number,
  options: ActiveLimitSupervisorOptions = {},
): Promise<ActiveLimitSupervisorResult> {
  if (
    !Number.isSafeInteger(processGroupLeaderPid) ||
    processGroupLeaderPid <= 0 ||
    processGroupLeaderPid === process.pid
  ) {
    throw new Error('A distinct positive process-group leader PID is required')
  }
  const clock = options.clock ?? systemClock
  const pollIntervalMs = options.pollIntervalMs ?? 1_000
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error('pollIntervalMs must be a positive safe integer')
  }
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const terminate = options.terminate ?? terminateProcessTree

  for (;;) {
    const state = loadState(attemptDirectory)
    const elapsed = activeElapsedMs(state, clock)
    if (elapsed >= state.timer.limitMs) {
      terminate(processGroupLeaderPid, 'SIGTERM')
      return {
        terminated: true,
        activeElapsedMs: elapsed,
        activeLimitMs: state.timer.limitMs,
      }
    }
    const remaining = state.timer.limitMs - elapsed
    await sleep(
      state.timer.runningSince
        ? Math.min(pollIntervalMs, remaining)
        : pollIntervalMs,
    )
  }
}
