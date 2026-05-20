export type JsonSliceSnapshot = {
  lastAppliedOrder: number
  state: Record<string, unknown>
}

export type JsonSliceStorage = {
  read: (sliceName: string) => JsonSliceSnapshot | undefined
  write: (sliceName: string, snapshot: JsonSliceSnapshot) => void
}

export function emptySnapshot(): JsonSliceSnapshot {
  return { lastAppliedOrder: 0, state: {} }
}
