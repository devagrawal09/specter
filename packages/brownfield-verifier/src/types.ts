import type {
  EventLogAdapter,
  ReactionScheduler,
  SliceStoreAdapter,
} from '@specter-ts/core'

export type ProbeWriteState = {
  readonly append: (value: string) => Promise<void>
}

export type ProbeReadState = {
  readonly values: () => Promise<readonly string[]>
}

export type ProbeSliceStore = SliceStoreAdapter<ProbeWriteState, ProbeReadState>

export type ReactionDeliveryStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'dead-letter'

export type ReactionDeliverySnapshot = {
  readonly deliveryId: string
  readonly status: ReactionDeliveryStatus
  readonly scheduledAt: string
  /** Attempt IDs in chronological order, including attempts before manual retry. */
  readonly attemptIds: readonly string[]
  /** Cumulative attempts for this delivery, including attempts before manual retry. */
  readonly attemptCount: number
  readonly lastError?: string
}

export type AdapterHarnessRuntime = {
  readonly eventLog: EventLogAdapter
  readonly sliceStore: ProbeSliceStore
  readonly schedule: ReactionScheduler
  readonly close: (options?: { readonly crash?: boolean }) => Promise<void>
}

export type AdapterHarnessDriver = {
  readonly name: string
  /**
   * Removes all verifier-owned Event, Slice, and scheduler records. Until a
   * timeout makes the suite terminal, the runner calls reset before and after
   * each entered case; no case may depend on another case's records or order.
   */
  readonly reset: () => Promise<void>
  /**
   * Opens the application's real adapters and durable worker using verifier
   * settings: three attempts, zero retry delay, and a short recovery lease.
   */
  readonly open: () => Promise<AdapterHarnessRuntime>
  /** Returns all verifier-owned deliveries; snapshot order is unspecified. */
  readonly deliveries: () => Promise<readonly ReactionDeliverySnapshot[]>
  /**
   * Requeues the same dead-lettered delivery. Its deliveryId and scheduledAt
   * remain stable, while attemptCount and attemptIds continue cumulatively.
   */
  readonly retryDeadLetter: (deliveryId: string) => Promise<void>
}

export type AdapterContractSuiteOptions = {
  /**
   * Wall-time limit for the case body and for each bounded pre/post reset
   * phase. Defaults to 5 seconds. A timeout is terminal for the disposable
   * verifier process because arbitrary promises cannot be cancelled; the
   * runner attempts one bounded post-reset and marks later cases not-run.
   */
  readonly caseTimeoutMs?: number
}

export type ContractCaseStatus = 'passed' | 'failed' | 'not-run'

export type ContractCaseResult = {
  readonly id: string
  readonly boundary: 'event-log' | 'slice-store' | 'scheduler' | 'probe'
  readonly status: ContractCaseStatus
  readonly durationMs: number
  readonly error?: string
}

export type AdapterContractReport = {
  readonly schemaVersion: 1
  readonly driver: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly passed: boolean
  readonly cases: readonly ContractCaseResult[]
}
