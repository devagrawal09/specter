import type {
  GardenConnection,
  GardenRecord,
  GardenRef,
  GardenSnapshot,
} from './garden-types'

export type GardenPlot = {
  id: string
  kind: 'topic' | 'meadow'
  anchor: GardenRecord | null
  records: GardenRecord[]
  palette: number
}

export function buildGardenPlots(snapshot: GardenSnapshot): GardenPlot[] {
  const topics = snapshot.records
    .filter((record) => record.kind === 'topic')
    .sort(compareRecords)
  const plots = topics.map<GardenPlot>((topic) => ({
    id: recordKey(topic),
    kind: 'topic',
    anchor: topic,
    records: [topic],
    palette: stableNumber(topic.id) % 4,
  }))
  const byTopic = new Map(plots.map((plot) => [plot.anchor?.id, plot]))
  const meadow: GardenPlot = {
    id: 'meadow',
    kind: 'meadow',
    anchor: null,
    records: [],
    palette: 0,
  }

  for (const record of snapshot.records.filter(
    (candidate) => candidate.kind !== 'topic',
  )) {
    const topicId = earliestTopicFor(record, snapshot.connections, byTopic)
    ;(topicId ? byTopic.get(topicId) : meadow)?.records.push(record)
  }

  for (const plot of plots) plot.records.sort(compareRecords)
  meadow.records.sort(compareRecords)
  if (meadow.records.length || plots.length === 0) plots.push(meadow)
  return plots
}

export function recordKey(record: GardenRecord | GardenRef) {
  return `${record.kind}:${record.id}`
}

export function stableNumber(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function summarizeGardenChanges(
  previous: GardenSnapshot,
  next: GardenSnapshot,
) {
  const previousRecords = new Map(
    previous.records.map((record) => [recordKey(record), record]),
  )
  const previousConnections = new Map(
    previous.connections.map((connection) => [connection.id, connection]),
  )
  const changes = new Map<string, number>()

  for (const record of next.records) {
    const old = previousRecords.get(recordKey(record))
    if (!old) addChange(changes, creationPhrase(record.kind))
    if (hasNewEffect(old, record, 'task-first-completed'))
      addChange(changes, 'crop ripened')
    if (hasNewEffect(old, record, 'topic-all-tasks-completed'))
      addChange(changes, 'tree grew fruit')
  }
  for (const connection of next.connections) {
    const old = previousConnections.get(connection.id)
    if (!old) addChange(changes, 'vine grew')
    if (hasNewEffect(old, connection, 'completed-task-connection'))
      addChange(changes, 'vine flowered')
  }

  const phrases = [...changes].map(([phrase, count]) =>
    count === 1 ? `1 ${phrase}` : `${count} ${pluralize(phrase)}`,
  )
  return phrases.length ? `Your garden changed: ${phrases.join(' · ')}` : null
}

function earliestTopicFor(
  record: GardenRecord,
  connections: GardenConnection[],
  topics: Map<string | undefined, GardenPlot>,
) {
  return connections
    .filter((connection) => references(connection, record))
    .map((connection) => ({
      connection,
      other: otherEnd(connection, record),
    }))
    .filter(
      (candidate) =>
        candidate.other.kind === 'topic' && topics.has(candidate.other.id),
    )
    .sort(
      (left, right) =>
        left.connection.connectedAt.localeCompare(
          right.connection.connectedAt,
        ) || left.connection.id.localeCompare(right.connection.id),
    )[0]?.other.id
}

function references(connection: GardenConnection, ref: GardenRef) {
  const key = recordKey(ref)
  return (
    recordKey(connection.left) === key || recordKey(connection.right) === key
  )
}

function otherEnd(connection: GardenConnection, ref: GardenRef) {
  return recordKey(connection.left) === recordKey(ref)
    ? connection.right
    : connection.left
}

function compareRecords(left: GardenRecord, right: GardenRecord) {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.kind.localeCompare(right.kind) ||
    left.id.localeCompare(right.id)
  )
}

function hasNewEffect(
  previous: { effects: { reason: string }[] } | undefined,
  next: { effects: { reason: string }[] },
  reason: string,
) {
  return (
    next.effects.some((effect) => effect.reason === reason) &&
    !previous?.effects.some((effect) => effect.reason === reason)
  )
}

function creationPhrase(kind: GardenRecord['kind']) {
  if (kind === 'journal') return 'flower grew'
  if (kind === 'task') return 'crop sprouted'
  return 'tree took root'
}

function addChange(changes: Map<string, number>, phrase: string) {
  changes.set(phrase, (changes.get(phrase) ?? 0) + 1)
}

function pluralize(phrase: string) {
  const [noun, ...rest] = phrase.split(' ')
  return `${noun}${noun.endsWith('s') ? 'es' : 's'} ${rest.join(' ')}`
}
