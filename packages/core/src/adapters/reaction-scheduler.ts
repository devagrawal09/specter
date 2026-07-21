export type ReactionDeliveryContext = {
  /** Stable across every retry of the same scheduled delivery. */
  readonly deliveryId: string
  /** ISO-8601 time captured once when this delivery was first scheduled. */
  readonly scheduledAt: string
  /** Stable for this attempt and different for a later retry. */
  readonly attemptId: string
  /** One-based attempt number for this delivery. */
  readonly attemptNumber: number
}

export type WaitForReactionsIdle = () => Promise<void>
/** Requests a Reaction pass and returns a factory for awaiting its idle point. */
export type RequestReactions = () => WaitForReactionsIdle

/**
 * Schedulers serialize Reaction passes. They may coalesce or queue requests,
 * but a Reaction may request another pass while the current pass is active
 * without starting a nested pass or requiring that Reaction to await itself.
 * The delivery context must be stable across retries so core can derive stable
 * per-Reaction effect IDs.
 */
export type ReactionScheduler = (
  run: (context: ReactionDeliveryContext) => Promise<void>,
) => RequestReactions
