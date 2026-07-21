import type { EventLogAdapter, ReactionScheduler } from '../adapters'
import type { ApplyEventDefinition, SliceRegistration } from '../definition'
import {
  createSpecterApp,
  type SpecterApp,
  type SpecterAppConfig,
  type SpecterObserver,
} from './app'

export type SpecterFeature = {
  readonly events: readonly ApplyEventDefinition[]
  readonly slices: readonly SliceRegistration[]
}

export type SpecterFeatureFactory<out TFeature extends SpecterFeature> =
  () => TFeature

export type SpecterFeatureAppConfig<
  TFactories extends readonly SpecterFeatureFactory<SpecterFeature>[],
> = {
  readonly eventLog: EventLogAdapter
  readonly schedule: ReactionScheduler
  readonly features: TFactories
  readonly observe?: SpecterObserver
  readonly dispose?: () => Promise<void>
}

type FeatureFromFactory<TFactory> =
  TFactory extends SpecterFeatureFactory<infer TFeature> ? TFeature : never

type ConfigFromFactories<
  TFactories extends readonly SpecterFeatureFactory<SpecterFeature>[],
> = SpecterAppConfig & {
  readonly events: FeatureFromFactory<TFactories[number]>['events']
  readonly slices: FeatureFromFactory<TFactories[number]>['slices']
}

/** Names one app-scoped feature factory without changing its inferred types. */
export function defineSpecterFeature<const TFeature extends SpecterFeature>(
  factory: SpecterFeatureFactory<TFeature>,
): SpecterFeatureFactory<TFeature> {
  return factory
}

/**
 * Creates every feature exactly once for this app. Stores and provider
 * adapters constructed inside factories therefore cannot leak across apps.
 */
export function createSpecterAppFromFeatures<
  const TFactories extends readonly SpecterFeatureFactory<SpecterFeature>[],
>(
  config: SpecterFeatureAppConfig<TFactories>,
): Promise<SpecterApp<ConfigFromFactories<TFactories>>> {
  const features = config.features.map((factory) => factory())
  return createSpecterApp({
    events: features.flatMap((feature) => feature.events),
    eventLog: config.eventLog,
    schedule: config.schedule,
    slices: features.flatMap((feature) => feature.slices),
    observe: config.observe,
    dispose: config.dispose,
  }) as Promise<SpecterApp<ConfigFromFactories<TFactories>>>
}
