// Public entry for a host process (OC++ core) that embeds the runtime.
// Hosts import only from here; everything else is the app's own layout.

// A Command's rejection: the runtime refused it with an exact reason.
export { SpecterCommandRejectedError } from '@specter-ts/core'
// The Event Log contract a host implements when it keeps the log itself.
export {
  type EventDraft,
  EventLog,
  type EventLogAppendOptions,
  type EventLogAppendResult,
  type EventLogCommit,
  EventLogFailure,
  type EventLogService,
  type PersistedEvent,
  SpecterVersionConflictError,
} from '@specter-ts/core'

export {
  createSessionAppConfig,
  createSliceStoreLayer,
  memorySliceStoreLayer,
  type ProvideSliceStore,
  type RunStepOutboxOptions,
  type RunStepOutboxStore,
} from './app.ts'
export {
  makeSessionEventStore,
  type SessionEventStore,
  sessionEventStoreConfig,
} from './event-store.ts'
export {
  type EmbeddedSessionRuntime,
  type EmbeddedSessionRuntimeOptions,
  makeEmbeddedSessionRuntime,
} from './embedded.ts'
export {
  type SessionEventPayloads,
  sessionEvent,
  sessionEventDefinitions,
  toOcppEventType,
  toSpecterEventType,
} from './events.ts'
export {
  type Delta,
  DeltaChannel,
  deltaChannelLayer,
} from './plugins/delta-channel.ts'
export {
  Model,
  type ModelInput,
  type ModelToolCall,
  type Outcome,
  type ToolSpec,
} from './plugins/model.ts'
export {
  type HostModelFailure,
  type HostModelSelection,
  hostModel,
} from './plugins/ocpp-ai-model.ts'
export type { RunStepOptions } from './plugins/run-step.ts'
export {
  type AttemptOutcome,
  type AttemptRecorder,
  type CompactFirst,
  type CompactionOutcome,
  DEFAULT_SYSTEM_PROMPT,
  type ModelStepHostOptions,
  modelStepHostLayer,
  type RecordFailure,
  StepHost,
  type StepPlan,
} from './plugins/step-host.ts'
