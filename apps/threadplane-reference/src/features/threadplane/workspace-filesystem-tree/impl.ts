import workspaceFilesystemTreeSpec from './spec'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  filesystemNodeChangedEvent,
  filesystemNodeDeletedEvent,
  filesystemNodeDiscoveredEvent,
} from '../events'

type WorkspaceFilesystemNode = {
  workspaceId: string
  path: string
  parentPath: string | null
  name: string
  kind: 'file' | 'directory'
  sizeBytes: number | null
  modifiedAt?: string
}

type WorkspaceFilesystemTreeState = {
  nodes: WorkspaceFilesystemNode[]
}

const workspaceFilesystemTree = workspaceFilesystemTreeSpec
  .inputSchema(
    z.object({
      workspaceId: z.string(),
      parentPath: z.string().nullable().optional(),
    }),
  )
  .outputSchema<WorkspaceFilesystemNode[]>()
  .store(
    createMemorySliceStore<WorkspaceFilesystemTreeState>(() => ({ nodes: [] })),
  )
  .apply(filesystemNodeDiscoveredEvent, async (event, state) => {
    const payload = event.payload as Awaited<
      ReturnType<typeof filesystemNodeDiscoveredEvent.decode>
    >
    const existingIndex = state.nodes.findIndex(
      (node) =>
        node.workspaceId === payload.workspaceId && node.path === payload.path,
    )
    const node = { ...payload }
    if (existingIndex >= 0) state.nodes[existingIndex] = node
    else state.nodes.push(node)
  })
  .apply(filesystemNodeChangedEvent, async (event, state) => {
    const payload = event.payload as Awaited<
      ReturnType<typeof filesystemNodeChangedEvent.decode>
    >
    const existingIndex = state.nodes.findIndex(
      (node) =>
        node.workspaceId === payload.workspaceId && node.path === payload.path,
    )
    const node = { ...payload }
    if (existingIndex >= 0) state.nodes[existingIndex] = node
    else state.nodes.push(node)
  })
  .apply(filesystemNodeDeletedEvent, async (event, state) => {
    const payload = event.payload as Awaited<
      ReturnType<typeof filesystemNodeDeletedEvent.decode>
    >
    state.nodes = state.nodes.filter(
      (node) =>
        node.workspaceId !== payload.workspaceId ||
        !(
          node.path === payload.path || node.path.startsWith(`${payload.path}/`)
        ),
    )
  })
  .handle(
    async (query, state): Promise<WorkspaceFilesystemNode[]> =>
      state.nodes
        .filter((node) => node.workspaceId === query.workspaceId)
        .filter(
          (node) =>
            query.parentPath === undefined ||
            node.parentPath === query.parentPath,
        ),
  )

export default workspaceFilesystemTree
