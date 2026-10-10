// `./testing/index`, not `./testing`: the built entry is `dist/testing.js`, which a consumer
// compiling with `allowJs` would resolve `./testing` to instead of `dist/testing/index.d.ts`.
export {
  analyzeEventPropagation,
  AdapterConformanceFailure,
  eventLogConformance,
  eventsFor,
  formatEventPropagation,
  replay,
  sliceStoreConformance,
  testEventLogService,
  testSliceStoreService,
  testSliceImplementation,
  testSliceImplementations,
} from './testing/index'
export type {
  CommandScenario,
  EventApplyReference,
  EventPropagation,
  EventPropagationInput,
  EventScenarioReference,
  QueryScenario,
  ReactionScenario,
  ScenarioEvent,
  ScenarioTestOptions,
  SliceStoreConformanceOptions,
} from './testing/index'
