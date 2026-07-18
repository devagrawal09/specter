import {
  activeElapsedMs,
  freezeRemediation,
  loadState,
  recordMarker,
  remediationElapsedMs,
  stopActiveTime,
  type Clock,
} from './runner.js'
import { terminateProcessTree } from './process-tree.js'
import { CHECKPOINT_LIMIT_MS, REMEDIATION_LIMIT_MS } from './types.js'

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
  paused?: boolean
  checkpointCaptured?: boolean
}

const systemClock: Clock = { now: () => new Date() }

export async function superviseActiveLimit(
  attemptDirectory: string,
  processGroupLeaderPid: number,
  options: ActiveLimitSupervisorOptions = {},
): Promise<ActiveLimitSupervisorResult> {
  return superviseLimit(processGroupLeaderPid, options, () => {
    const state = loadState(attemptDirectory)
    return {
      elapsedMs: activeElapsedMs(state, options.clock ?? systemClock),
      limitMs: state.timer.limitMs,
      completed: Boolean(state.freeze),
      running: Boolean(state.timer.runningSince),
    }
  })
}

export async function superviseCheckpointLimit(
  attemptDirectory: string,
  processGroupLeaderPid: number,
  options: ActiveLimitSupervisorOptions = {},
): Promise<ActiveLimitSupervisorResult> {
  validateSupervisorOptions(processGroupLeaderPid, options)
  const clock = options.clock ?? systemClock
  const pollIntervalMs = options.pollIntervalMs ?? 1_000
  const sleep = supervisorSleep(options)
  const terminate = options.terminate ?? terminateProcessTree

  for (;;) {
    let state = loadState(attemptDirectory)
    const elapsed = activeElapsedMs(state, clock)
    const checkpoint = state.markers.find(
      (marker) => marker.kind === 'checkpoint',
    )
    if (checkpoint) {
      const shouldTerminate = Boolean(state.timer.runningSince)
      if (shouldTerminate) terminate(processGroupLeaderPid, 'SIGTERM')
      if (state.timer.runningSince) {
        state = stopActiveTime(
          attemptDirectory,
          {
            reason: 'checkpoint-capture',
            triggerEvidence: `checkpoint marker recorded at ${checkpoint.recordedAt}`,
            coordinatorAction:
              'stopped adopter process group and preserved checkpoint snapshot',
          },
          clock,
        )
      }
      return {
        terminated: shouldTerminate,
        activeElapsedMs: activeElapsedMs(state, clock),
        activeLimitMs: CHECKPOINT_LIMIT_MS,
        paused: !state.timer.runningSince,
        checkpointCaptured: true,
      }
    }
    if (elapsed >= CHECKPOINT_LIMIT_MS) {
      terminate(processGroupLeaderPid, 'SIGTERM')
      let captured = false
      let captureFailure: unknown
      if (state.markers.some((marker) => marker.kind === 'bootstrap')) {
        try {
          state = recordMarker(
            attemptDirectory,
            'checkpoint',
            'time-expired',
            'Automatically captured at the 75-active-minute ceiling',
            clock,
          )
          captured = true
        } catch (cause) {
          captureFailure = cause
        }
      }
      if (state.timer.runningSince) {
        state = stopActiveTime(
          attemptDirectory,
          {
            reason: 'checkpoint-capture',
            triggerEvidence: `checkpoint active-time ceiling reached at ${elapsed}ms`,
            coordinatorAction:
              'terminated adopter process group and captured the current checkpoint',
          },
          clock,
        )
      }
      if (captureFailure) throw captureFailure
      return {
        terminated: true,
        activeElapsedMs: activeElapsedMs(state, clock),
        activeLimitMs: CHECKPOINT_LIMIT_MS,
        paused: !state.timer.runningSince,
        checkpointCaptured: captured,
      }
    }
    await sleep(
      state.timer.runningSince
        ? Math.min(pollIntervalMs, CHECKPOINT_LIMIT_MS - elapsed)
        : pollIntervalMs,
    )
  }
}

export async function superviseRemediationLimit(
  attemptDirectory: string,
  processGroupLeaderPid: number,
  options: ActiveLimitSupervisorOptions = {},
): Promise<ActiveLimitSupervisorResult> {
  validateSupervisorOptions(processGroupLeaderPid, options)
  const clock = options.clock ?? systemClock
  const pollIntervalMs = options.pollIntervalMs ?? 1_000
  const sleep = supervisorSleep(options)
  const terminate = options.terminate ?? terminateProcessTree

  for (;;) {
    const state = loadState(attemptDirectory)
    const remediation = state.remediation
    if (!remediation) throw new Error('Remediation has not started')
    const elapsed = remediationElapsedMs(state, clock)
    if (remediation.snapshot || remediation.finishedAt) {
      return {
        terminated: false,
        activeElapsedMs: elapsed,
        activeLimitMs: REMEDIATION_LIMIT_MS,
      }
    }
    if (elapsed >= remediation.timer.limitMs) {
      terminate(processGroupLeaderPid, 'SIGTERM')
      const frozen = freezeRemediation(attemptDirectory, clock)
      return {
        terminated: true,
        activeElapsedMs: remediationElapsedMs(frozen, clock),
        activeLimitMs: remediation.timer.limitMs,
        paused: true,
      }
    }
    await sleep(
      remediation.timer.runningSince
        ? Math.min(pollIntervalMs, remediation.timer.limitMs - elapsed)
        : pollIntervalMs,
    )
  }
}

async function superviseLimit(
  processGroupLeaderPid: number,
  options: ActiveLimitSupervisorOptions,
  status: () => {
    readonly elapsedMs: number
    readonly limitMs: number
    readonly completed: boolean
    readonly running: boolean
  },
): Promise<ActiveLimitSupervisorResult> {
  validateSupervisorOptions(processGroupLeaderPid, options)
  const pollIntervalMs = options.pollIntervalMs ?? 1_000
  const sleep = supervisorSleep(options)
  const terminate = options.terminate ?? terminateProcessTree
  for (;;) {
    const current = status()
    if (current.completed) {
      return {
        terminated: false,
        activeElapsedMs: current.elapsedMs,
        activeLimitMs: current.limitMs,
      }
    }
    if (current.elapsedMs >= current.limitMs) {
      terminate(processGroupLeaderPid, 'SIGTERM')
      return {
        terminated: true,
        activeElapsedMs: current.elapsedMs,
        activeLimitMs: current.limitMs,
      }
    }
    await sleep(
      current.running
        ? Math.min(pollIntervalMs, current.limitMs - current.elapsedMs)
        : pollIntervalMs,
    )
  }
}

function validateSupervisorOptions(
  processGroupLeaderPid: number,
  options: ActiveLimitSupervisorOptions,
): void {
  if (
    !Number.isSafeInteger(processGroupLeaderPid) ||
    processGroupLeaderPid <= 0 ||
    processGroupLeaderPid === process.pid
  ) {
    throw new Error('A distinct positive process-group leader PID is required')
  }
  const pollIntervalMs = options.pollIntervalMs ?? 1_000
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error('pollIntervalMs must be a positive safe integer')
  }
}

function supervisorSleep(
  options: ActiveLimitSupervisorOptions,
): (milliseconds: number) => Promise<void> {
  return (
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  )
}
