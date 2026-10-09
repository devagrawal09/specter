// Public entry for a host process (OC++ core) that embeds the runtime.
// Hosts import only from here; everything else is the app's own layout.

export {
  createSessionAppConfig,
  createSliceStoreLayer,
  memorySliceStoreLayer,
  type ProvideSliceStore,
  type RunStepOutboxOptions,
  type RunStepOutboxStore,
} from './app.ts'
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
