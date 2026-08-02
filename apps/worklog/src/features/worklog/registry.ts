import type { CommandRef, QueryRef } from '@specter-ts/core'

import { addJournalEntry } from './add-journal-entry/impl'
import { addTask } from './add-task/impl'
import { addTopic } from './add-topic/impl'
import { changeConnectionArchived } from './change-connection-archived/impl'
import { changeJournalEntryArchived } from './change-journal-entry-archived/impl'
import { changeTaskArchived } from './change-task-archived/impl'
import { changeTaskCompletion } from './change-task-completion/impl'
import { changeTopicArchived } from './change-topic-archived/impl'
import { connectRecords } from './connect-records/impl'
import { connectionsQuery } from './connections-query/impl'
import { editJournalEntry } from './edit-journal-entry/impl'
import { editTask } from './edit-task/impl'
import { editTopic } from './edit-topic/impl'
import { gardenQuery } from './garden-query/impl'
import { worklogEventDefinitions } from './events'
import { scoreQuery } from './score-query/impl'
import { tasksQuery } from './tasks-query/impl'
import { timelineQuery } from './timeline-query/impl'
import { topicsQuery } from './topics-query/impl'

export const worklogRegistrations = {
  addJournalEntry,
  editJournalEntry,
  changeJournalEntryArchived,
  addTask,
  editTask,
  changeTaskCompletion,
  changeTaskArchived,
  addTopic,
  editTopic,
  changeTopicArchived,
  connectRecords,
  changeConnectionArchived,
  timelineQuery,
  tasksQuery,
  topicsQuery,
  connectionsQuery,
  scoreQuery,
  gardenQuery,
} as const

export const worklogAppConfig = {
  events: worklogEventDefinitions,
  slices: worklogRegistrations,
} as const

export type WorklogAppConfig = typeof worklogAppConfig
export type AddJournalEntryRef = CommandRef<typeof addJournalEntry>
export type AddTaskRef = CommandRef<typeof addTask>
export type AddTopicRef = CommandRef<typeof addTopic>
export type TimelineQueryRef = QueryRef<typeof timelineQuery>
export type TasksQueryRef = QueryRef<typeof tasksQuery>
export type TopicsQueryRef = QueryRef<typeof topicsQuery>
export type ScoreQueryRef = QueryRef<typeof scoreQuery>
export type GardenQueryRef = QueryRef<typeof gardenQuery>
