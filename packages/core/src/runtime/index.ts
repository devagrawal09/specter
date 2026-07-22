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
  SpecterProjectionFailedError,
  SpecterStoreConfigurationError,
  SpecterStoreFailureError,
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
