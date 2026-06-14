export type WaitForReactionsIdle = () => Promise<void>
export type RequestReactions = () => WaitForReactionsIdle
export type ReactionScheduler = (run: () => Promise<void>) => RequestReactions
