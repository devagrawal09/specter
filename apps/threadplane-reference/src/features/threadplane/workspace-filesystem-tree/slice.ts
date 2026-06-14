import { createQuerySlice } from '@specter-ts/core'
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

const workspaceFilesystemTree = createQuerySlice(
  'workspaceFilesystemTree',
  'Lists normalized filesystem metadata nodes for a workspace.',
)
  .schema(
    z.object({
      workspaceId: z.string(),
      parentPath: z.string().nullable().optional(),
    }),
  )
  .store(
    createMemorySliceStore<WorkspaceFilesystemTreeState>(() => ({ nodes: [] })),
  )
  .apply({
    [filesystemNodeDiscoveredEvent.type]: async (event, state) => {
      const payload = await filesystemNodeDiscoveredEvent.decode(event.payload)
      const existingIndex = state.nodes.findIndex(
        (node) =>
          node.workspaceId === payload.workspaceId &&
          node.path === payload.path,
      )
      const node = { ...payload }
      if (existingIndex >= 0) state.nodes[existingIndex] = node
      else state.nodes.push(node)
    },
    [filesystemNodeChangedEvent.type]: async (event, state) => {
      const payload = await filesystemNodeChangedEvent.decode(event.payload)
      const existingIndex = state.nodes.findIndex(
        (node) =>
          node.workspaceId === payload.workspaceId &&
          node.path === payload.path,
      )
      const node = { ...payload }
      if (existingIndex >= 0) state.nodes[existingIndex] = node
      else state.nodes.push(node)
    },
    [filesystemNodeDeletedEvent.type]: async (event, state) => {
      const payload = await filesystemNodeDeletedEvent.decode(event.payload)
      state.nodes = state.nodes.filter(
        (node) =>
          node.workspaceId !== payload.workspaceId ||
          !(
            node.path === payload.path ||
            node.path.startsWith(`${payload.path}/`)
          ),
      )
    },
  })
  .scenarios(
    {
      description:
        'Lists normalized nodes for one workspace and excludes deleted nodes.',
      given: [
        filesystemNodeDiscoveredEvent.create({
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          path: 'src',
          parentPath: null,
          name: 'src',
          kind: 'directory',
          sizeBytes: null,
        }),
        filesystemNodeDiscoveredEvent.create({
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          path: 'src/index.ts',
          parentPath: 'src',
          name: 'index.ts',
          kind: 'file',
          sizeBytes: 42,
          modifiedAt: '2026-06-13T12:00:00.000Z',
        }),
        filesystemNodeChangedEvent.create({
          scanId: 'scan-2',
          workspaceId: 'workspace-1',
          path: 'src/index.ts',
          parentPath: 'src',
          name: 'index.ts',
          kind: 'file',
          sizeBytes: 84,
          modifiedAt: '2026-06-13T12:01:00.000Z',
        }),
        filesystemNodeDiscoveredEvent.create({
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          path: 'README.md',
          parentPath: null,
          name: 'README.md',
          kind: 'file',
          sizeBytes: 12,
        }),
        filesystemNodeDeletedEvent.create({
          scanId: 'scan-2',
          workspaceId: 'workspace-1',
          path: 'README.md',
        }),
        filesystemNodeDiscoveredEvent.create({
          scanId: 'scan-1',
          workspaceId: 'workspace-2',
          path: 'wrong.txt',
          parentPath: null,
          name: 'wrong.txt',
          kind: 'file',
          sizeBytes: 1,
        }),
      ],
      when: { workspaceId: 'workspace-1' },
      expect: [
        {
          workspaceId: 'workspace-1',
          path: 'src',
          parentPath: null,
          name: 'src',
          kind: 'directory',
          sizeBytes: null,
        },
        {
          workspaceId: 'workspace-1',
          path: 'src/index.ts',
          parentPath: 'src',
          name: 'index.ts',
          kind: 'file',
          sizeBytes: 84,
          modifiedAt: '2026-06-13T12:01:00.000Z',
        },
      ],
    },
    {
      description: 'Lists direct children for a selected parent path.',
      given: [
        filesystemNodeDiscoveredEvent.create({
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          path: 'src',
          parentPath: null,
          name: 'src',
          kind: 'directory',
          sizeBytes: null,
        }),
        filesystemNodeDiscoveredEvent.create({
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          path: 'src/index.ts',
          parentPath: 'src',
          name: 'index.ts',
          kind: 'file',
          sizeBytes: 42,
        }),
      ],
      when: { workspaceId: 'workspace-1', parentPath: 'src' },
      expect: [
        {
          workspaceId: 'workspace-1',
          path: 'src/index.ts',
          parentPath: 'src',
          name: 'index.ts',
          kind: 'file',
          sizeBytes: 42,
        },
      ],
    },
    {
      description:
        'Removes a deleted directory and all descendants from the tree.',
      given: [
        filesystemNodeDiscoveredEvent.create({
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          path: 'src',
          parentPath: null,
          name: 'src',
          kind: 'directory',
          sizeBytes: null,
        }),
        filesystemNodeDiscoveredEvent.create({
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          path: 'src/index.ts',
          parentPath: 'src',
          name: 'index.ts',
          kind: 'file',
          sizeBytes: 42,
        }),
        filesystemNodeDiscoveredEvent.create({
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          path: 'README.md',
          parentPath: null,
          name: 'README.md',
          kind: 'file',
          sizeBytes: 12,
        }),
        filesystemNodeDeletedEvent.create({
          scanId: 'scan-2',
          workspaceId: 'workspace-1',
          path: 'src',
        }),
      ],
      when: { workspaceId: 'workspace-1' },
      expect: [
        {
          workspaceId: 'workspace-1',
          path: 'README.md',
          parentPath: null,
          name: 'README.md',
          kind: 'file',
          sizeBytes: 12,
        },
      ],
    },
  )
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
