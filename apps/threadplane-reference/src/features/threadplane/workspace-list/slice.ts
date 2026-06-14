import { createQuerySlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { workspaceCreatedEvent } from '../events'

type WorkspaceListItem = {
  id: string
  name: string
  createdBy?: {
    userId?: string
    displayName: string
  }
}

type WorkspaceListState = {
  workspaces: WorkspaceListItem[]
}

const workspaceList = createQuerySlice(
  'workspaceList',
  'Lists workspaces available to the current user.',
)
  .schema(z.object({}))
  .store(createMemorySliceStore<WorkspaceListState>(() => ({ workspaces: [] })))
  .apply({})
  .scenarios({
    description: 'Lists workspaces in creation order.',
    given: [
      workspaceCreatedEvent.create({
        workspaceId: 'workspace-1',
        name: 'Main Workspace',
        createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      }),
      workspaceCreatedEvent.create({
        workspaceId: 'workspace-2',
        name: 'Design Lab',
      }),
    ],
    when: {},
    expect: [
      {
        id: 'workspace-1',
        name: 'Main Workspace',
        createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      },
      { id: 'workspace-2', name: 'Design Lab' },
    ],
  })
  .handle(async (): Promise<WorkspaceListItem[]> => {
    throw new Error('TODO: implement workspaceList')
  })

export default workspaceList
