// The two history-cut rules shared by every projection of Session history
// (session-history-query, fork-session, stage-revert, model-transcript-query).
// A real shared boundary now exists: four Slices fold the same facts, and a
// change to cut semantics must not be made in four places. Pure functions over
// a caller-owned item list; each Slice keeps its own item shape and state.

export type ForkBoundary = {
  type: 'before' | 'through'
  messageID: string
}

// Number of leading items a fork copies, or -1 when the boundary message is
// not in the history.
export const forkCut = <T>(
  history: readonly T[],
  boundary: ForkBoundary,
  id: (item: T) => string | undefined,
) => {
  const index = history.findIndex((item) => id(item) === boundary.messageID)
  if (index === -1) return -1
  return boundary.type === 'before' ? index : index + 1
}

// A committed revert ends history at `to`, inclusive. Returns the kept items,
// or undefined when `to` is not in the history (nothing changes).
export const revertCut = <T>(
  history: readonly T[],
  to: string,
  id: (item: T) => string | undefined,
) => {
  const index = history.findIndex((item) => id(item) === to)
  return index === -1 ? undefined : history.slice(0, index + 1)
}
