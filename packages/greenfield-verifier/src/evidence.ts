import type { CheckVisibility, EvidenceKind, Gate } from './types.js'

export interface EvidencePlacement {
  gate: Gate
  visibility: CheckVisibility
}

export const canonicalEvidencePlacement: Readonly<
  Record<EvidenceKind, EvidencePlacement>
> = {
  starterBaseline: { gate: 'bootstrap', visibility: 'visible' },
  scenarioCoverage: { gate: 'verticalPath', visibility: 'visible' },
  wholeAppScenarioCoverage: {
    gate: 'domainCompleteness',
    visibility: 'visible',
  },
  acceptedCommandExactEvents: {
    gate: 'verticalPath',
    visibility: 'visible',
  },
  rejectedCommandNoCommit: {
    gate: 'verticalPath',
    visibility: 'visible',
  },
  invalidInputNoCommit: { gate: 'verticalPath', visibility: 'visible' },
  idempotentDuplicate: { gate: 'robustness', visibility: 'heldOut' },
  concurrentDecision: { gate: 'robustness', visibility: 'heldOut' },
  restartEquivalence: { gate: 'robustness', visibility: 'heldOut' },
  projectionCatchUp: { gate: 'robustness', visibility: 'heldOut' },
  projectionReplayRepair: { gate: 'robustness', visibility: 'heldOut' },
  cursorPublicationSafety: { gate: 'robustness', visibility: 'heldOut' },
  eventGlobalOrder: { gate: 'robustness', visibility: 'heldOut' },
  commandReactionCompletion: {
    gate: 'domainCompleteness',
    visibility: 'visible',
  },
  reactionDeliveryRecovery: { gate: 'robustness', visibility: 'heldOut' },
  httpJsonBoundary: { gate: 'domainCompleteness', visibility: 'visible' },
  httpErrorBoundary: { gate: 'robustness', visibility: 'heldOut' },
  sseLifecycle: { gate: 'robustness', visibility: 'heldOut' },
  browserJourney: { gate: 'domainCompleteness', visibility: 'visible' },
  sqliteRecovery: { gate: 'robustness', visibility: 'heldOut' },
  postgresSerialization: { gate: 'robustness', visibility: 'heldOut' },
  postgresOutboxClaim: { gate: 'robustness', visibility: 'heldOut' },
}

export const standardClaims: Readonly<Record<EvidenceKind, readonly string[]>> =
  {
    starterBaseline: [
      'starterTypecheckPassed',
      'starterTestsPassed',
      'starterBuildPassed',
      'browserPreflightPassed',
      'starterBrowserWorkflowPassed',
      'assignedStrictPortUsed',
    ],
    scenarioCoverage: [
      'checkpointSliceCovered',
      'checkpointEventsCovered',
      'scenariosAreExact',
      'focusedTestsUseFocusedCatalog',
    ],
    wholeAppScenarioCoverage: [
      'allRegisteredSlicesCovered',
      'allRegisteredEventsCovered',
      'scenariosAreExact',
      'focusedTestsUseFocusedCatalog',
    ],
    acceptedCommandExactEvents: [
      'commandAccepted',
      'eventsCommitted',
      'durableEventsExact',
    ],
    rejectedCommandNoCommit: [
      'commandRejected',
      'rejectionExact',
      'noEventsCommitted',
    ],
    invalidInputNoCommit: ['schemaRejected', 'noEventsCommitted'],
    idempotentDuplicate: ['sameCommitReturned', 'noAdditionalEventsCommitted'],
    concurrentDecision: [
      'decisionsSerializedOrStaleRejected',
      'noInvalidCommit',
    ],
    restartEquivalence: [
      'decisionStateEquivalent',
      'queryStateEquivalent',
      'eventLogAuthoritative',
    ],
    projectionCatchUp: ['strictlyAfterCursor', 'stateEquivalentAfterCatchUp'],
    projectionReplayRepair: ['projectionRepaired', 'stateDerivedFromEvents'],
    cursorPublicationSafety: ['applyAndCursorAtomicOrSafelyIdempotent'],
    eventGlobalOrder: ['eventIdsUnique', 'globalOrderStrictlyAscending'],
    commandReactionCompletion: [
      'commitObservableBeforeReactionCompletion',
      'reactionCompletionSeparatelyObservable',
    ],
    reactionDeliveryRecovery: [
      'failedAttemptPersisted',
      'deliveryIdStableAcrossRetries',
      'scheduledAtStableAcrossRetries',
      'attemptIdChangesAcrossRetries',
      'noDuplicateEffect',
      'recoverySurvivesRestart',
      'terminalSuccessOrDeadLetterVisible',
    ],
    httpJsonBoundary: ['registeredEnvelopesOnly', 'jsonValuesOnly'],
    httpErrorBoundary: [
      'structuredErrorsStable',
      'unexpectedFailuresNotLeaked',
    ],
    sseLifecycle: [
      'initialValueEmitted',
      'updatedValueEmitted',
      'updateNotCausedByLocalRefresh',
      'reconnectContinues',
      'abortCleansUp',
    ],
    browserJourney: ['briefOutcomeSatisfied', 'publicTransportUsed'],
    sqliteRecovery: ['realOnDiskDatabaseUsed', 'restartAndReplayPassed'],
    postgresSerialization: ['multipleProcessesUsed', 'commandsSerialized'],
    postgresOutboxClaim: ['multipleWorkersUsed', 'ticketClaimedAtMostOnce'],
  }

export const requiredEvidenceKinds: readonly EvidenceKind[] = [
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
] as const
