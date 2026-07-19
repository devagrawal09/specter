export type EntityKind = 'journal' | 'task' | 'topic'

export type EntityRef = {
  kind: EntityKind
  id: string
}

export type PointSubjectRef = EntityRef | { kind: 'connection'; id: string }

export type JournalEntry = {
  id: string
  body: string
  activityAt: string
  createdAt: string
  archived: boolean
}

export type Task = {
  id: string
  title: string
  notes: string | null
  dueAt: string | null
  createdAt: string
  completed: boolean
  completedAt: string | null
  archived: boolean
}

export type Topic = {
  id: string
  name: string
  description: string | null
  createdAt: string
  archived: boolean
}

export type Connection = {
  id: string
  left: EntityRef
  right: EntityRef
  connectedAt: string
  archived: boolean
}

export type PointReason =
  | 'journal-added'
  | 'task-added'
  | 'topic-added'
  | 'connection-added'
  | 'task-first-completed'
  | 'completed-task-connection'
  | 'topic-all-tasks-completed'

export type PointAward = {
  awardKey: string
  reason: PointReason
  points: 1
  subject: PointSubjectRef
  related: EntityRef[]
  awardedAt: string
}

export function entityRefKey(ref: EntityRef) {
  return `${ref.kind}:${ref.id}`
}

export function connectionPairKey(left: EntityRef, right: EntityRef) {
  return [entityRefKey(left), entityRefKey(right)].sort().join('|')
}

export function references(connection: Connection, ref: EntityRef) {
  const key = entityRefKey(ref)
  return (
    entityRefKey(connection.left) === key ||
    entityRefKey(connection.right) === key
  )
}

export function otherEnd(connection: Connection, ref: EntityRef) {
  return entityRefKey(connection.left) === entityRefKey(ref)
    ? connection.right
    : connection.left
}
