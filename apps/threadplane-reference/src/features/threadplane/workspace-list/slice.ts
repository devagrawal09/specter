import { createQuerySlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'

type WorkspaceListState = {
  workspaces: {
    id: string
    name: string
  }[]
}

const workspaceList = createQuerySlice(
  'workspaceList',
  'Lists workspaces available to the current user.',
)
  .schema(z.object({}))
  .store(createMemorySliceStore<WorkspaceListState>(() => ({ workspaces: [] })))

export default workspaceList
