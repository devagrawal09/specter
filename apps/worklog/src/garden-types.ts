export type GardenRecordKind = 'journal' | 'task' | 'topic'
export type GardenEffectReason =
  | 'task-first-completed'
  | 'completed-task-connection'
  | 'topic-all-tasks-completed'

export type GardenRef = { kind: GardenRecordKind; id: string }
export type GardenEffect = {
  reason: GardenEffectReason
  awardedAt: string
}
export type GardenRecord = {
  id: string
  kind: GardenRecordKind
  label: string
  detail: string | null
  createdAt: string
  archived: boolean
  effects: GardenEffect[]
}
export type GardenConnection = {
  id: string
  left: GardenRef
  right: GardenRef
  connectedAt: string
  archived: boolean
  effects: GardenEffect[]
}
export type GardenSnapshot = {
  totalPoints: number
  records: GardenRecord[]
  connections: GardenConnection[]
}
export type GardenMood = 'day' | 'sunset' | 'night'

export const emptyGarden: GardenSnapshot = {
  totalPoints: 0,
  records: [],
  connections: [],
}
