export type JsonPrimitive = boolean | null | number | string
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }

export const gates = [
  'bootstrap',
  'verticalPath',
  'domainCompleteness',
  'robustness',
] as const

export type Gate = (typeof gates)[number]
export type CheckVisibility = 'visible' | 'heldOut'
export type PersistenceProfile = 'sqlite' | 'postgres'
export type AttemptPhase = 'firstAttempt' | 'remediation'

export const evidenceKinds = [
  'starterBaseline',
  'scenarioCoverage',
  'wholeAppScenarioCoverage',
  'acceptedCommandExactEvents',
  'rejectedCommandNoCommit',
  'invalidInputNoCommit',
  'idempotentDuplicate',
  'concurrentDecision',
  'restartEquivalence',
  'projectionCatchUp',
  'projectionReplayRepair',
  'cursorPublicationSafety',
  'eventGlobalOrder',
  'commandReactionCompletion',
  'reactionDeliveryRecovery',
  'httpJsonBoundary',
  'httpErrorBoundary',
  'sseLifecycle',
  'browserJourney',
  'sqliteRecovery',
  'postgresSerialization',
  'postgresOutboxClaim',
] as const

export type EvidenceKind = (typeof evidenceKinds)[number]

export interface EvidenceRequirement {
  kind: EvidenceKind
  description: string
  /** Additional coordinator-owned claims beyond the kind's standard claims. */
  additionalClaims?: string[]
}

export interface CheckDefinition {
  id: string
  title: string
  gate: Gate
  visibility: CheckVisibility
  mandatory: boolean
  evidence: EvidenceRequirement
  timeoutMs?: number
  tags?: string[]
}

export interface SourceConsultation {
  source: string
  reason: string
}

export type GeneratorDisposition = 'kept' | 'changed' | 'notReused'
export type GeneratorMode = 'dryRun' | 'generate'
export type SliceKind = 'command' | 'query' | 'reaction'

export interface GeneratorInvocation {
  generator: 'slice' | 'persistentHarness'
  mode: GeneratorMode
  target: string
  sliceKind?: SliceKind
  /** Exactly one chronological coordinate is required. */
  timestamp?: string
  activeMinute?: number
  transcriptSha256: string
  succeeded: boolean
  disposition?: GeneratorDisposition
  rationale?: string
}

export interface FirstSliceUseRecord {
  sliceKind: SliceKind
  target: string
  /** Must use the same coordinate form as the target's generator pair. */
  timestamp?: string
  activeMinute?: number
}

export interface PersistentHarnessFirstUseRecord {
  target: string
  /** Must use the same coordinate form as the harness generator pair. */
  timestamp?: string
  activeMinute?: number
}

export interface PhaseRecord {
  phase: 'bootstrap' | 'verticalPath' | 'completeApp'
  activeMinutes: number
  wallMinutes: number
  iterations: number
  sourceConsultations: SourceConsultation[]
  generatorInvocations: GeneratorInvocation[]
}

export interface AttemptWorkMetadata {
  startedAt: string
  frozenAt: string
  activeMinutes: number
  wallMinutes: number
  iterations: number
  sliceKindsUsed: SliceKind[]
  firstSliceUses: FirstSliceUseRecord[]
  persistentHarnessFirstUse?: PersistentHarnessFirstUseRecord
  phases: PhaseRecord[]
  implementationSize?: {
    filesChanged: number
    linesAdded: number
    linesDeleted: number
  }
}

export interface RemediationMetadata {
  startedAt: string
  frozenAt: string
  activeMinutes: number
  wallMinutes: number
  iterations: number
  sourceConsultations: SourceConsultation[]
}

export interface AttemptDescriptor {
  id: string
  domain: string
  persistence: PersistenceProfile
  topology: 'singleProcess' | 'multiProcess'
  port: number
  specterVersion: string
  activeLimitMinutes: 180
  firstAttempt: AttemptWorkMetadata
  remediation?: RemediationMetadata
}

export interface VerificationPlan {
  schemaVersion: 1
  attempt: AttemptDescriptor
  checks: CheckDefinition[]
}

export interface EvidenceComparison {
  label: string
  expected: JsonValue
  actual: JsonValue
}

export interface EvidenceObservation {
  /** Semantic claims observed by the coordinator-owned project driver. */
  claims: Record<string, boolean>
  /** Exact oracle/actual comparisons; the verifier performs deep equality. */
  comparisons?: EvidenceComparison[]
  details?: Record<string, JsonValue>
  artifacts?: string[]
}

export const semanticCapabilities = [
  'command',
  'query',
  'subscription',
  'eventLog',
  'reactionDelivery',
  'restart',
  'replay',
  'faultInjection',
  'processControl',
  'outbox',
  'browser',
] as const

export type SemanticCapability = (typeof semanticCapabilities)[number]

/**
 * A brief-owned request understood by the frozen app adapter. It deliberately
 * contains no verifier check ID, gate, visibility, expected value, or claim.
 */
export interface SemanticProbeRequest {
  semanticId: string
  capability: SemanticCapability
  input?: JsonValue
  phase: AttemptPhase
  signal: AbortSignal
}

export interface SemanticProbeResult {
  /** Canonical facts/public values plus any raw ordering or delivery metadata. */
  value: JsonValue
  artifacts?: string[]
}

/**
 * Project-owned mapping from stable brief semantics to unconstrained app
 * envelopes, Event names, persistence records, and operational controls.
 */
export interface ProjectSemanticAdapter {
  setup?(context: {
    attempt: Readonly<AttemptDescriptor>
    phase: AttemptPhase
    signal: AbortSignal
  }): Promise<void>
  probe(request: SemanticProbeRequest): Promise<SemanticProbeResult>
  teardown?(context: {
    attempt: Readonly<AttemptDescriptor>
    phase: AttemptPhase
    signal: AbortSignal
  }): Promise<void>
}

export interface DriverCheckContext {
  attempt: Readonly<AttemptDescriptor>
  check: Readonly<CheckDefinition>
  phase: AttemptPhase
  signal: AbortSignal
}

export interface DriverLifecycleContext {
  attempt: Readonly<AttemptDescriptor>
  check: Readonly<CheckDefinition>
  phase: AttemptPhase
  signal: AbortSignal
}

export interface DriverTeardownContext extends DriverLifecycleContext {
  reason: 'completed' | 'checkError' | 'timedOut' | 'setupError'
}

export interface GreenfieldDriver {
  setup(context: DriverLifecycleContext): Promise<void>
  runCheck(context: DriverCheckContext): Promise<EvidenceObservation>
  teardown(context: DriverTeardownContext): Promise<void>
}

export type GreenfieldDriverFactory = (
  plan: Readonly<VerificationPlan>,
) => GreenfieldDriver | Promise<GreenfieldDriver>

export interface CheckResult {
  id: string
  title: string
  gate: Gate
  visibility: CheckVisibility
  mandatory: boolean
  evidenceKind: EvidenceKind
  status: 'passed' | 'failed' | 'error' | 'timedOut'
  durationMs: number
  failedClaims: string[]
  mismatches: Array<{
    label: string
    expected: JsonValue
    actual: JsonValue
  }>
  diagnostics: string[]
  details?: Record<string, JsonValue>
  artifacts: string[]
}

export interface GateResult {
  gate: Gate
  passed: boolean
  cumulative: true
  mandatoryChecks: number
  failedCheckIds: string[]
  blockedByEarlierGate: Gate | null
}

export interface PhaseVerificationResult {
  phase: AttemptPhase
  checks: CheckResult[]
  gates: GateResult[]
  allMandatoryChecksPassed: boolean
  isolationCompromised: boolean
}

export interface VerificationResult {
  schemaVersion: 1
  attempt: AttemptDescriptor
  firstAttempt: PhaseVerificationResult
  fullFirstAttemptSuccess: boolean
  firstAttemptWithinActiveLimit: boolean
  remediation: PhaseVerificationResult | null
  eventualSuccess: boolean | null
}

export interface VerificationOptions {
  runRemediation?: boolean
  now?: () => number
  /** Time allowed for runCheck/setup to settle after its signal is aborted. */
  abortGraceMs?: number
  /** Hard limit for each per-check teardown call. */
  cleanupTimeoutMs?: number
  /** Hard limit for each per-check setup call. */
  setupTimeoutMs?: number
}
