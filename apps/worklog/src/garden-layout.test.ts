import { describe, expect, test } from 'vitest'

import {
  buildGardenPlots,
  stableNumber,
  summarizeGardenChanges,
} from './garden-layout'
import type { GardenRecord, GardenSnapshot } from './garden-types'

const at = '2026-07-18T15:00:00.000Z'

describe('garden layout', () => {
  test('places a shared record once in its earliest topic and keeps a meadow', () => {
    const topicA = record('topic-a', 'topic', 'Topic A')
    const topicB = record('topic-b', 'topic', 'Topic B')
    const task = record('task-1', 'task', 'Shared task')
    const journal = record('journal-1', 'journal', 'Solo note')
    const snapshot: GardenSnapshot = {
      totalPoints: 6,
      records: [topicA, topicB, task, journal],
      connections: [
        {
          id: 'later',
          left: { kind: 'task', id: task.id },
          right: { kind: 'topic', id: topicA.id },
          connectedAt: '2026-07-18T18:00:00.000Z',
          archived: false,
          effects: [],
        },
        {
          id: 'earlier',
          left: { kind: 'task', id: task.id },
          right: { kind: 'topic', id: topicB.id },
          connectedAt: '2026-07-18T17:00:00.000Z',
          archived: true,
          effects: [],
        },
      ],
    }

    const plots = buildGardenPlots(snapshot)
    expect(
      plots.find((plot) => plot.anchor?.id === topicB.id)?.records,
    ).toContain(task)
    expect(
      plots.find((plot) => plot.anchor?.id === topicA.id)?.records,
    ).not.toContain(task)
    expect(plots.find((plot) => plot.kind === 'meadow')?.records).toEqual([
      journal,
    ])
  })

  test('derives stable palettes and variants from durable IDs', () => {
    expect(stableNumber('topic-1')).toBe(stableNumber('topic-1'))
    expect(stableNumber('topic-1')).not.toBe(stableNumber('topic-2'))
  })
})

describe('garden update summaries', () => {
  test('combines new plants, vines, and milestone growth in one notice', () => {
    const task = {
      ...record('task-1', 'task', 'Ship it'),
      effects: [
        {
          reason: 'task-first-completed' as const,
          awardedAt: at,
        },
      ],
    }
    const topic = {
      ...record('topic-1', 'topic', 'Release'),
      effects: [
        {
          reason: 'topic-all-tasks-completed' as const,
          awardedAt: at,
        },
      ],
    }
    const next: GardenSnapshot = {
      totalPoints: 6,
      records: [task, topic],
      connections: [
        {
          id: 'connection-1',
          left: { kind: 'task', id: task.id },
          right: { kind: 'topic', id: topic.id },
          connectedAt: at,
          archived: false,
          effects: [{ reason: 'completed-task-connection', awardedAt: at }],
        },
      ],
    }

    expect(summarizeGardenChanges(emptySnapshot(), next)).toBe(
      'Your garden changed: 1 crop sprouted · 1 crop ripened · 1 tree took root · 1 tree grew fruit · 1 vine grew · 1 vine flowered',
    )
  })

  test('ignores edits, archival changes, and unchanged growth', () => {
    const previous = {
      ...emptySnapshot(),
      records: [record('journal-1', 'journal', 'Before')],
    }
    const next = {
      ...previous,
      records: [{ ...previous.records[0], label: 'After', archived: true }],
    }
    expect(summarizeGardenChanges(previous, next)).toBeNull()
  })
})

function record(
  id: string,
  kind: GardenRecord['kind'],
  label: string,
): GardenRecord {
  return {
    id,
    kind,
    label,
    detail: null,
    createdAt: at,
    archived: false,
    effects: [],
  }
}

function emptySnapshot(): GardenSnapshot {
  return { totalPoints: 0, records: [], connections: [] }
}
