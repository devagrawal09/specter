import { Context, Effect, Layer, PubSub } from 'effect'

// Ephemeral deltas never enter the Event Log (findings: transport
// side-channel). The step plugin publishes here; whoever hosts the app
// subscribes (M4: a bridge to OC++'s Bus ephemeral PubSubs).
export type Delta = {
  sessionID: string
  type: 'session.text.delta'
  text: string
}

export class DeltaChannel extends Context.Service<
  DeltaChannel,
  { readonly pubsub: PubSub.PubSub<Delta> }
>()('@specter/agent-runtime/DeltaChannel') {}

export const deltaChannelLayer = Layer.effect(
  DeltaChannel,
  Effect.map(PubSub.unbounded<Delta>(), (pubsub) => ({ pubsub })),
)
