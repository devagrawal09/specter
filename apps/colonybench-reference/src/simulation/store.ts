import type { SliceStoreService } from '@specter-ts/core'
import { Context } from 'effect'

import type { ColonyBenchSimulationState } from './state'

export class ColonyBenchSimulationStore extends Context.Service<
  ColonyBenchSimulationStore,
  SliceStoreService<
    Readonly<ColonyBenchSimulationState>,
    ColonyBenchSimulationState,
    unknown
  >
>()('@specter/colonybench/SimulationStore') {}

export const simulationStore = ColonyBenchSimulationStore
