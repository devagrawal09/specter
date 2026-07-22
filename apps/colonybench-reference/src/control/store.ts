import type { SliceStoreService } from '@specter-ts/core'
import { Context } from 'effect'

import type { ColonyBenchControlState } from './state'

export class ColonyBenchControlStore extends Context.Service<
  ColonyBenchControlStore,
  SliceStoreService<
    Readonly<ColonyBenchControlState>,
    ColonyBenchControlState,
    unknown
  >
>()('@specter/colonybench/ControlStore') {}

export const controlStore = ColonyBenchControlStore
