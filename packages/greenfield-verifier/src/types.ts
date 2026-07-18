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
export type CoordinatorSnapshotKind =
  | 'bootstrap'
  | 'checkpoint'
  | 'final'
  | 'remediation'

export interface CoordinatorBinding {
  attemptId: string
  configSha256: string
  snapshotKind: CoordinatorSnapshotKind
  snapshotManifestSha256: string
  verificationPlanSha256: string
}

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

export const adopterMappedCapabilities = [
  'command',
  'query',
  'subscription',
  'eventLog',
  'browser',
] as const

export type AdopterMappedCapability = (typeof adopterMappedCapabilities)[number]

export type JsonPointer = `/${string}`

export interface ObjectFieldMapping {
  /** Destination JSON Pointer to source JSON Pointer. Constants are forbidden. */
  fields: Readonly<Record<JsonPointer, JsonPointer>>
}

export interface ResultNormalization {
  kind: 'identity' | 'objectFields'
  fields?: Readonly<Record<string, JsonPointer>>
}

export interface EnvelopeSemanticMapping {
  capability: 'command' | 'query'
  envelopeType: string
  request:
    | { kind: 'identity' }
    | ({ kind: 'objectFields' } & ObjectFieldMapping)
  result: ResultNormalization
}

export interface SubscriptionSemanticMapping {
  capability: 'subscription'
  queryEnvelopeType: string
  request:
    | { kind: 'identity' }
    | ({ kind: 'objectFields' } & ObjectFieldMapping)
  result: ResultNormalization
}

export interface EventFactMapping {
  eventType: string
  canonicalType: string
  payload: ResultNormalization
}

export interface EventLogSemanticMapping {
  capability: 'eventLog'
  events: readonly EventFactMapping[]
}

export interface BrowserSemanticMapping {
  capability: 'browser'
  route: string
  selectors: Readonly<Record<string, string>>
}

export type SemanticMapping =
  | BrowserSemanticMapping
  | EnvelopeSemanticMapping
  | EventLogSemanticMapping
  | SubscriptionSemanticMapping

/**
 * Frozen adopter-owned data. It cannot execute checks, restart processes,
 * inject faults, inspect databases, or report pass/fail claims.
 */
export interface ProjectSemanticMap {
  schemaVersion: 1
  domain: string
  mappings: Readonly<Record<string, SemanticMapping>>
}

export type ObservationChannel =
  | 'browser'
  | 'database'
  | 'eventLog'
  | 'http'
  | 'outbox'
  | 'process'
  | 'sse'

/** Raw evidence captured by coordinator-owned services, never by adopter code. */
export interface CoordinatorObservation {
  semanticId: string
  capability: SemanticCapability
  channels: Readonly<Partial<Record<ObservationChannel, JsonValue>>>
  normalized: JsonValue
  parity: readonly EvidenceComparison[]
  artifacts: readonly string[]
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
  /** Added by the CLI when invoked by the phase-aware coordinator runner. */
  coordinatorBinding?: CoordinatorBinding
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
