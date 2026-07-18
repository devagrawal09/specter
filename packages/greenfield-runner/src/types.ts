export const ACTIVE_LIMIT_MS = 180 * 60 * 1000
export const CHECKPOINT_LIMIT_MS = 75 * 60 * 1000
export const REMEDIATION_LIMIT_MS = 60 * 60 * 1000

export type DomainKind = 'replication' | 'transfer'
export type PersistenceProfile = 'sqlite' | 'postgres'
export type ProcessTopology = 'single-process' | 'multi-process'
export type MarkerKind = 'bootstrap' | 'checkpoint' | 'final-freeze'
export type SnapshotKind = 'bootstrap' | 'checkpoint' | 'final' | 'remediation'
export type MarkerOutcome = 'passed' | 'failed' | 'time-expired'
export type SuiteKind = 'visible' | 'held-out'
export const pauseReasons = [
  'checkpoint-capture',
  'coordinator-service-recovery',
  'coordinator-approval',
  'final-freeze',
] as const
export type PauseReason = (typeof pauseReasons)[number]

export interface PauseRequest {
  readonly reason: PauseReason
  readonly triggerEvidence: string
  readonly coordinatorAction: string
}

export interface PauseRecord extends PauseRequest {
  readonly startedAt: string
  readonly endedAt?: string
  readonly wallElapsedMs?: number
}

export interface EvaluationCommand {
  readonly id: string
  readonly file: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly timeoutMs: number
  readonly env?: Readonly<Record<string, string>>
}

export interface MatrixEntry {
  readonly attemptId: string
  readonly domainId: string
  readonly domainName: string
  readonly domainKind: DomainKind
  readonly attemptNumber: 1 | 2
  readonly persistence: PersistenceProfile
  readonly topology: ProcessTopology
  readonly port: number
  readonly workspacePath: string
  readonly freezePaths: readonly string[]
  readonly visibleCommands: readonly EvaluationCommand[]
  readonly heldOutCommands: readonly EvaluationCommand[]
}

export interface PackageProvenance {
  readonly name: string
  readonly version: string
  readonly artifactId: string
  readonly sha256: string
}

export type ArtifactAudience = 'private' | 'public'

export const provenanceArtifactKinds = [
  'adopterPrompt',
  'browserFixture',
  'candidateTable',
  'checkCases',
  'checkCatalog',
  'coordinatorDriver',
  'developerPolicy',
  'domainBrief',
  'environmentFailureSignatures',
  'evaluationRunner',
  'executionCatalog',
  'frictionCodebook',
  'guidance',
  'heldOutSuite',
  'initializer',
  'methodology',
  'randomizedSchedule',
  'recommendationEvidenceMap',
  'reviewerAssignment',
  'semanticCatalog',
  'semanticMapContract',
  'serviceFixture',
  'specterPackage',
  'systemPolicy',
  'toolPolicy',
  'verificationPlan',
  'verifier',
  'visibleSuite',
] as const

export type ProvenanceArtifactKind = (typeof provenanceArtifactKinds)[number]

export interface FrozenArtifactProvenance {
  readonly id: string
  readonly audience: ArtifactAudience
  readonly kind: ProvenanceArtifactKind
  readonly sha256: string
}

export interface RuntimeProvenance {
  readonly model: {
    readonly provider: string
    readonly id: string
    readonly build: string
    readonly reasoningSetting: string
    readonly sampler: Readonly<Record<string, boolean | null | number | string>>
  }
  readonly agentHarness: { readonly name: string; readonly version: string }
  readonly platform: {
    readonly operatingSystem: string
    readonly release: string
    readonly architecture: string
  }
  readonly toolchain: {
    readonly node: string
    readonly packageManager: string
    readonly browser: string
    readonly browserRevision: string
  }
  readonly services: readonly {
    readonly id: string
    readonly version: string
    readonly digest?: string
  }[]
  readonly executionImage: {
    readonly name: string
    readonly sha256: string
  }
  readonly resourceLimits: {
    readonly contextTokens: number
    readonly cpuCores: number
    readonly memoryMiB: number
    readonly activeMinutes: 180
    readonly checkpointMinutes: 75
    readonly remediationMinutes: 60
  }
  readonly dependencyCache: { readonly id: string; readonly sha256: string }
  readonly imageInputs: readonly {
    readonly id: string
    readonly sha256: string
  }[]
  readonly runOrderSeed: string
  /** Exact preregistered order: all five attempt-1 runs, then attempt-2 runs. */
  readonly runOrder: readonly string[]
  readonly freshContexts: readonly {
    readonly attemptId: string
    readonly taskId: string
    readonly initialContextTokens: number
    readonly freshTask: true
    readonly parentTaskId: null
  }[]
}

export interface FrozenProvenance {
  readonly specterCommit: string
  readonly artifactManifestSha256: string
  readonly artifacts: readonly FrozenArtifactProvenance[]
  readonly packages: readonly PackageProvenance[]
  readonly runtime: RuntimeProvenance
}

export interface CoordinatorDomain {
  readonly domainId: string
  readonly domainName: string
  readonly domainKind: DomainKind
  readonly persistence: PersistenceProfile
  readonly port: number
}

export type EvaluationCommandTemplate = EvaluationCommand

export interface CoordinatorCatalog {
  readonly domains: readonly CoordinatorDomain[]
  readonly workspacePath: string
  readonly freezePaths: readonly string[]
  readonly visibleCommands: readonly EvaluationCommandTemplate[]
  readonly heldOutCommands: readonly EvaluationCommandTemplate[]
}

export type AdopterAssignment = Omit<MatrixEntry, 'heldOutCommands'>

export interface ProvenanceBuildInput {
  readonly specterCommit: string
  readonly artifacts: readonly {
    readonly id: string
    readonly audience: ArtifactAudience
    readonly kind: ProvenanceArtifactKind
    readonly path: string
  }[]
  readonly packageTarballs: readonly {
    readonly name: string
    readonly version: string
    readonly artifactId: string
    readonly path: string
  }[]
  readonly runtime: RuntimeProvenance
  readonly expected?: ExpectedProvenanceDigests
}

export interface ExpectedProvenanceDigests {
  readonly artifactManifestSha256?: string
  readonly artifacts?: Readonly<Record<string, string>>
  readonly packageTarballs?: Readonly<Record<string, string>>
}

export interface ActiveLimitWatchdog {
  readonly remainingMs: number
  readonly expired: Promise<boolean>
  cancel(): void
}

export interface PreparedAttempt {
  readonly schemaVersion: 1
  readonly assignment: MatrixEntry
  readonly provenance: FrozenProvenance
  /** Absolute public root mounted into the adopter sandbox for this attempt. */
  readonly adopterDirectory: string
  readonly configSha256: string
  readonly preparedAt: string
}

export interface ActiveTimer {
  readonly limitMs: number
  readonly accumulatedMs: number
  readonly runningSince?: string
  readonly sessions: readonly {
    readonly startedAt: string
    readonly stoppedAt: string
    readonly elapsedMs: number
  }[]
  readonly pauses: readonly PauseRecord[]
}

export interface AttemptMarker {
  readonly kind: MarkerKind
  readonly outcome: MarkerOutcome
  readonly recordedAt: string
  readonly activeElapsedMs: number
  readonly note?: string
}

export interface CommandExecutionRequest {
  readonly command: EvaluationCommand
  readonly cwd: string
  readonly timeoutMs: number
}

export interface CommandExecutionResult {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly durationMs: number
}

export interface CommandRunner {
  run(request: CommandExecutionRequest): Promise<CommandExecutionResult>
}

export interface RecordedCommandResult {
  readonly id: string
  readonly file: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly durationMs: number
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly timedOut: boolean
  readonly stdoutLog: string
  readonly stderrLog: string
  readonly passed: boolean
}

export interface SnapshotRecord {
  readonly kind: SnapshotKind
  readonly capturedAt: string
  readonly sourcePaths: readonly string[]
  readonly manifestSha256: string
}

export interface VerifierBinding {
  readonly attemptId: string
  readonly configSha256: string
  readonly snapshotKind: SnapshotKind
  readonly snapshotManifestSha256: string
  readonly verificationPlanSha256: string
}

export interface VerifierResultRecord {
  readonly path: string
  readonly sha256: string
  readonly binding: VerifierBinding
  readonly fullFirstAttemptSuccess: boolean
  readonly isolationCompromised: boolean
  readonly gates: Readonly<{
    bootstrap: boolean
    verticalPath: boolean
    domainCompleteness: boolean
    robustness: boolean
  }>
}

export interface PhaseSuiteRun {
  readonly snapshot: SnapshotRecord
  readonly verificationArtifacts: string
  readonly commands: readonly RecordedCommandResult[]
  readonly commandPassed: boolean
  readonly harnessFailure?: string
  readonly verifierResult?: VerifierResultRecord
}

export interface SuiteRun {
  readonly kind: SuiteKind
  readonly startedAt: string
  readonly finishedAt: string
  readonly passed: boolean
  readonly verificationArtifacts: string
  readonly commands: readonly RecordedCommandResult[]
  readonly phaseRuns: readonly PhaseSuiteRun[]
  readonly harnessFailure?: string
  readonly verifierGates?: Readonly<{
    bootstrap: boolean
    verticalPath: boolean
    domainCompleteness: boolean
    robustness: boolean
  }>
}

export interface FreezeRecord {
  readonly frozenAt: string
  readonly sourcePaths: readonly string[]
  readonly manifestSha256: string
}

export interface AttemptState {
  readonly schemaVersion: 1
  readonly attemptId: string
  readonly preparedAt: string
  readonly timer: ActiveTimer
  readonly markers: readonly AttemptMarker[]
  readonly snapshots: Partial<Record<SnapshotKind, SnapshotRecord>>
  readonly suites: Partial<Record<SuiteKind, SuiteRun>>
  readonly freeze?: FreezeRecord
  readonly remediation?: {
    readonly startedAt: string
    readonly timer: ActiveTimer
    readonly finishedAt?: string
    readonly outcome?: 'passed' | 'failed'
    readonly resultSha256?: string
    readonly snapshot?: SnapshotRecord
    readonly verifierBinding?: VerifierBinding
    readonly note?: string
  }
}

export type GateOutcome = 'passed' | 'failed' | 'not-reached'

export interface AttemptReport {
  readonly schemaVersion: 1
  readonly attemptId: string
  readonly domainId: string
  readonly domainName: string
  readonly domainKind: DomainKind
  readonly attemptNumber: 1 | 2
  readonly persistence: PersistenceProfile
  readonly topology: ProcessTopology
  readonly port: number
  readonly configSha256: string
  readonly activeLimitMs: number
  readonly activeElapsedMs: number
  readonly activeLimitExceeded: boolean
  readonly timing: {
    readonly setupWallMs: number | null
    readonly bootstrapActiveMs: number | null
    readonly verticalPathActiveMs: number | null
    readonly fullAppActiveMs: number | null
    readonly totalActiveMs: number
    readonly scoredWallMs: number | null
  }
  readonly gates: {
    readonly bootstrap: GateOutcome
    readonly verticalPath: GateOutcome
    readonly domainCompleteness: GateOutcome
    readonly robustness: GateOutcome
  }
  readonly fullFirstAttemptSuccess: boolean
  readonly frozen: boolean
  readonly visibleVerificationPassed: boolean | null
  readonly heldOutVerificationPassed: boolean | null
  readonly remediation: {
    readonly started: boolean
    readonly finished: boolean
    readonly eventualSuccess: boolean | null
    readonly extraWallMs: number | null
  }
}

export interface AggregateGroup {
  readonly attempts: number
  readonly fullFirstAttemptSuccesses: number
  readonly bootstrapPassed: number
  readonly verticalPathPassed: number
  readonly domainCompletenessPassed: number
  readonly robustnessPassed: number
}

export interface AggregateReport {
  readonly schemaVersion: 1
  readonly attempts: readonly AttemptReport[]
  readonly totals: AggregateGroup
  readonly byDomainKind: Readonly<Record<DomainKind, AggregateGroup>>
  readonly byPersistence: Readonly<Record<PersistenceProfile, AggregateGroup>>
}
