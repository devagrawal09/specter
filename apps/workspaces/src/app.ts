import { join } from 'node:path'
import { createSpecterApp } from '@specter-ts/core'
import {
  createMemoryEventLogLayer,
  createMemorySliceStoreLayer,
  createImmediateReactionSchedulerLayer,
} from '@specter-ts/memory'
import {
  createJsonlEventLogLayer,
  createJsonlSliceStoreLayer,
} from '@specter-ts/jsonl'
import { Layer } from 'effect'
import { events } from './features/workspace/events'
import {
  saveDocument,
  Store as saveDocumentStore,
  createState as saveDocumentState,
} from './features/workspace/save-document/impl'
import {
  postMessage,
  Store as postMessageStore,
  createState as postMessageState,
} from './features/workspace/post-message/impl'
import {
  setTask,
  Store as setTaskStore,
  createState as setTaskState,
} from './features/workspace/set-task/impl'
import {
  setView,
  Store as setViewStore,
  createState as setViewState,
} from './features/workspace/set-view/impl'
import {
  appendMessage,
  Store as appendMessageStore,
  createState as appendMessageState,
} from './features/workspace/append-message/impl'
import {
  workspace,
  Store as workspaceStore,
  createState as workspaceState,
} from './features/workspace/workspace/impl'

export const config = {
  events,
  slices: {
    saveDocument,
    postMessage,
    setTask,
    setView,
    appendMessage,
    workspace,
  },
} as const

// The only execution/storage choice: slices and their contracts are identical.
export const openWorkspace = (directory?: string) =>
  createSpecterApp(
    config,
    Layer.mergeAll(
      createImmediateReactionSchedulerLayer(),
      directory
        ? createJsonlEventLogLayer({
            path: join(directory, 'events.jsonl'),
            fsync: true,
          })
        : createMemoryEventLogLayer(),
      directory
        ? createJsonlSliceStoreLayer(saveDocumentStore, saveDocumentState, {
            directory: join(directory, 'slices'),
            fsync: true,
          })
        : createMemorySliceStoreLayer(saveDocumentStore, saveDocumentState),
      directory
        ? createJsonlSliceStoreLayer(postMessageStore, postMessageState, {
            directory: join(directory, 'slices'),
            fsync: true,
          })
        : createMemorySliceStoreLayer(postMessageStore, postMessageState),
      directory
        ? createJsonlSliceStoreLayer(setTaskStore, setTaskState, {
            directory: join(directory, 'slices'),
            fsync: true,
          })
        : createMemorySliceStoreLayer(setTaskStore, setTaskState),
      directory
        ? createJsonlSliceStoreLayer(setViewStore, setViewState, {
            directory: join(directory, 'slices'),
            fsync: true,
          })
        : createMemorySliceStoreLayer(setViewStore, setViewState),
      directory
        ? createJsonlSliceStoreLayer(appendMessageStore, appendMessageState, {
            directory: join(directory, 'slices'),
            fsync: true,
          })
        : createMemorySliceStoreLayer(appendMessageStore, appendMessageState),
      directory
        ? createJsonlSliceStoreLayer(workspaceStore, workspaceState, {
            directory: join(directory, 'slices'),
            fsync: true,
          })
        : createMemorySliceStoreLayer(workspaceStore, workspaceState),
    ),
  )
export type WorkspaceApp = Awaited<ReturnType<typeof openWorkspace>>
