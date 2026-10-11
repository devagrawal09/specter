export const specterErrorCodes = {
  commandRejected: 'SPECTER_COMMAND_REJECTED',
  conformanceFailed: 'SPECTER_CONFORMANCE_FAILED',
  eventLogCapability: 'SPECTER_EVENT_LOG_CAPABILITY',
  eventLogOrderViolation: 'SPECTER_EVENT_LOG_ORDER_VIOLATION',
  idempotencyConflict: 'SPECTER_IDEMPOTENCY_CONFLICT',
  infrastructureFailure: 'SPECTER_INFRASTRUCTURE_FAILURE',
  invalidCommandOptions: 'SPECTER_INVALID_COMMAND_OPTIONS',
  invalidInput: 'SPECTER_INVALID_INPUT',
  invalidOutput: 'SPECTER_INVALID_OUTPUT',
  pluginQueryInTransaction: 'SPECTER_PLUGIN_QUERY_IN_TRANSACTION',
  projectionFailed: 'SPECTER_PROJECTION_FAILED',
  reactionFailure: 'SPECTER_REACTION_FAILURE',
  storeConfiguration: 'SPECTER_STORE_CONFIGURATION',
  storeFailure: 'SPECTER_STORE_FAILURE',
  unknownCommand: 'SPECTER_UNKNOWN_COMMAND',
  unknownEvent: 'SPECTER_UNKNOWN_EVENT',
  unknownQuery: 'SPECTER_UNKNOWN_QUERY',
  versionConflict: 'SPECTER_VERSION_CONFLICT',
} as const

export type SpecterErrorCode =
  (typeof specterErrorCodes)[keyof typeof specterErrorCodes]

export class SpecterError extends Error {
  readonly code: SpecterErrorCode

  constructor(code: SpecterErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SpecterError'
    this.code = code
  }
}

export class SpecterUnknownCommandError extends SpecterError {
  readonly commandType: string

  constructor(commandType: string) {
    super(
      specterErrorCodes.unknownCommand,
      `Unknown Command Slice: "${commandType}".`,
    )
    this.name = 'SpecterUnknownCommandError'
    this.commandType = commandType
  }
}

export class SpecterUnknownQueryError extends SpecterError {
  readonly queryType: string

  constructor(queryType: string) {
    super(
      specterErrorCodes.unknownQuery,
      `Unknown Query Slice: "${queryType}".`,
    )
    this.name = 'SpecterUnknownQueryError'
    this.queryType = queryType
  }
}

export class SpecterUnknownEventError extends SpecterError {
  readonly eventType: string

  constructor(eventType: string) {
    super(specterErrorCodes.unknownEvent, `Unknown Event type: "${eventType}".`)
    this.name = 'SpecterUnknownEventError'
    this.eventType = eventType
  }
}

export type SpecterOperationKind = 'command' | 'query' | 'reaction'

export class SpecterInvalidInputError extends SpecterError {
  readonly operationKind: Extract<SpecterOperationKind, 'command' | 'query'>
  readonly operationType: string

  constructor(
    operationKind: Extract<SpecterOperationKind, 'command' | 'query'>,
    operationType: string,
    cause: unknown,
  ) {
    super(
      specterErrorCodes.invalidInput,
      `Invalid ${operationKind} input for "${operationType}".`,
      { cause },
    )
    this.name = 'SpecterInvalidInputError'
    this.operationKind = operationKind
    this.operationType = operationType
  }
}

export class SpecterInvalidOutputError extends SpecterError {
  readonly operationKind: Extract<SpecterOperationKind, 'query' | 'reaction'>
  readonly operationType: string

  constructor(
    operationKind: Extract<SpecterOperationKind, 'query' | 'reaction'>,
    operationType: string,
    cause: unknown,
  ) {
    super(
      specterErrorCodes.invalidOutput,
      `Invalid ${operationKind} output for "${operationType}".`,
      { cause },
    )
    this.name = 'SpecterInvalidOutputError'
    this.operationKind = operationKind
    this.operationType = operationType
  }
}

/**
 * A Command handler's refusal: a stable kebab-case `code` hosts match on, a
 * message for people, and optional structured `details`. A handler throws it;
 * the runtime then rejects the Command with a `SpecterCommandRejectedError`
 * carrying it. Every code a Command rejects with must appear in one of its
 * rejected Scenarios.
 */
export class CommandRejection extends Error {
  readonly _tag = 'CommandRejection' as const
  readonly code: string
  readonly details?: unknown

  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'CommandRejection'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

/** A Command was rejected: its handler threw `rejection`. */
export class SpecterCommandRejectedError extends SpecterError {
  readonly commandType: string
  readonly rejection: CommandRejection

  constructor(commandType: string, rejection: CommandRejection) {
    super(
      specterErrorCodes.commandRejected,
      `Command "${commandType}" rejected (${rejection.code}): ${rejection.message}`,
      { cause: rejection },
    )
    this.name = 'SpecterCommandRejectedError'
    this.commandType = commandType
    this.rejection = rejection
  }
}

export class SpecterProjectionFailedError extends SpecterError {
  readonly sliceName: string

  constructor(sliceName: string, cause: unknown) {
    super(
      specterErrorCodes.projectionFailed,
      `Projection apply failed for Slice "${sliceName}".`,
      { cause },
    )
    this.name = 'SpecterProjectionFailedError'
    this.sliceName = sliceName
  }
}

export class SpecterStoreConfigurationError extends SpecterError {
  readonly _tag = 'SpecterStoreConfigurationError' as const
  readonly sliceName: string
  readonly storeKey?: string

  constructor(sliceName: string, message: string, storeKey?: string) {
    super(specterErrorCodes.storeConfiguration, message)
    this.name = 'SpecterStoreConfigurationError'
    this.sliceName = sliceName
    this.storeKey = storeKey
  }
}

export class SpecterStoreFailureError extends SpecterError {
  readonly _tag = 'SpecterStoreFailureError' as const

  constructor(
    readonly sliceName: string,
    readonly operation: 'read' | 'transaction',
    cause: unknown,
  ) {
    super(
      specterErrorCodes.storeFailure,
      `Store ${operation} failed for Slice "${sliceName}".`,
      { cause },
    )
    this.name = 'SpecterStoreFailureError'
  }
}

export class SpecterVersionConflictError extends SpecterError {
  readonly expectedVersion: number
  readonly actualVersion: number

  constructor(expectedVersion: number, actualVersion: number) {
    super(
      specterErrorCodes.versionConflict,
      `Event Log version conflict: expected ${expectedVersion}, received ${actualVersion}.`,
    )
    this.name = 'SpecterVersionConflictError'
    this.expectedVersion = expectedVersion
    this.actualVersion = actualVersion
  }
}

export class SpecterIdempotencyConflictError extends SpecterError {
  readonly idempotencyKey: string

  constructor(idempotencyKey: string) {
    super(
      specterErrorCodes.idempotencyConflict,
      `Idempotency key "${idempotencyKey}" was already used for a different Command.`,
    )
    this.name = 'SpecterIdempotencyConflictError'
    this.idempotencyKey = idempotencyKey
  }
}

export class SpecterInvalidCommandOptionsError extends SpecterError {
  constructor(message: string, options?: ErrorOptions) {
    super(specterErrorCodes.invalidCommandOptions, message, options)
    this.name = 'SpecterInvalidCommandOptionsError'
  }
}

export class SpecterEventLogOrderError extends SpecterError {
  readonly afterOrder: number
  readonly receivedOrders: readonly number[]

  constructor(afterOrder: number, receivedOrders: readonly number[]) {
    super(
      specterErrorCodes.eventLogOrderViolation,
      `Event Log query after order ${afterOrder} returned invalid ordering: [${receivedOrders.join(', ')}]. Results must have unique, strictly ascending orders greater than the cursor.`,
    )
    this.name = 'SpecterEventLogOrderError'
    this.afterOrder = afterOrder
    this.receivedOrders = receivedOrders
  }
}

/**
 * The Event Log lacks a capability the app uses: the runtime refuses to start
 * on it rather than let a Command's compare-and-swap, or a host's keyed read,
 * silently do less than it promises.
 */
export class SpecterEventLogCapabilityError extends SpecterError {
  readonly missing: readonly string[]

  constructor(missing: readonly { capability: string; usedBy: string }[]) {
    super(
      specterErrorCodes.eventLogCapability,
      `The Event Log does not support ${missing
        .map(({ capability, usedBy }) => `${capability} (${usedBy})`)
        .join(
          ' or ',
        )}. Provide an Event Log adapter whose capabilities declare ${
        missing.length === 1 ? 'it' : 'them'
      }.`,
    )
    this.name = 'SpecterEventLogCapabilityError'
    this.missing = missing.map(({ capability }) => capability)
  }
}

export class SpecterInfrastructureError extends SpecterError {
  constructor(message: string, cause: unknown) {
    super(specterErrorCodes.infrastructureFailure, message, { cause })
    this.name = 'SpecterInfrastructureError'
  }
}

/**
 * A direct Reaction Plugin called `query` inside its Slice Store transaction.
 * Retrying cannot succeed, so the Reaction run fails permanently and its cursor
 * stays on the commit until the Plugin changes.
 */
export class SpecterPluginQueryInTransactionError extends SpecterError {
  readonly reactionName: string
  readonly queryName: string

  constructor(reactionName: string, queryName: string) {
    super(
      specterErrorCodes.pluginQueryInTransaction,
      `Reaction "${reactionName}" Plugin queried "${queryName}" inside its Slice Store transaction. Wrap the Plugin with withReactionOutbox to run Queries.`,
    )
    this.name = 'SpecterPluginQueryInTransactionError'
    this.reactionName = reactionName
    this.queryName = queryName
  }
}

export type ReactionRunFailureDetail = {
  readonly sliceName: string
  readonly cause: unknown
}

export class ReactionRunFailure extends AggregateError {
  readonly code = specterErrorCodes.reactionFailure
  readonly failures: readonly ReactionRunFailureDetail[]
  /**
   * True when a failure cannot succeed on retry. The commit boundary can never
   * complete, so schedulers stop retrying and report the failure instead.
   */
  readonly permanent: boolean

  constructor(failures: readonly ReactionRunFailureDetail[]) {
    super(
      failures.map(({ cause }) => cause),
      reactionRunFailureMessage(failures),
    )
    this.name = 'ReactionRunFailure'
    this.failures = failures
    this.permanent = failures.some(({ cause }) => isPermanentCause(cause))
  }
}

function isPermanentCause(cause: unknown): boolean {
  for (let current = cause, depth = 0; depth < 8; depth += 1) {
    if (current instanceof SpecterPluginQueryInTransactionError) return true
    if (!(current instanceof Error)) return false
    current = current.cause
  }
  return false
}

function reactionRunFailureMessage(
  failures: readonly ReactionRunFailureDetail[],
) {
  const sliceNames = [...new Set(failures.map(({ sliceName }) => sliceName))]

  return `Reaction run failed for: ${sliceNames.join(', ')}`
}
