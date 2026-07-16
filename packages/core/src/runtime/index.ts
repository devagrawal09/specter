export { createSpecterApp } from './app'
export type {
  CommandExecution,
  CommandExecutionOptions,
  QuerySubscriptionOptions,
  SpecterApp,
  SpecterAppConfig,
  SpecterAppConfigOf,
  SpecterCommandEnvelope,
  SpecterCommandType,
  SpecterObservation,
  SpecterObserver,
  SpecterQueryEnvelope,
  SpecterQueryResult,
  SpecterQueryType,
} from './app'
export {
  ReactionRunFailure,
  specterErrorCodes,
  SpecterCommandRejectedError,
  SpecterError,
  SpecterEventLogOrderError,
  SpecterIdempotencyConflictError,
  SpecterInfrastructureError,
  SpecterInvalidCommandOptionsError,
  SpecterInvalidInputError,
  SpecterInvalidOutputError,
  SpecterUnknownCommandError,
  SpecterUnknownEventError,
  SpecterUnknownQueryError,
  SpecterVersionConflictError,
} from './errors'
export type {
  ReactionRunFailureDetail,
  SpecterErrorCode,
  SpecterOperationKind,
} from './errors'
