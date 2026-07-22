import type { SliceStoreService } from '@specter-ts/core'
import { Context } from 'effect'

import type { CollectorState } from './collector-model'

export class CollectorStore extends Context.Service<
  CollectorStore,
  SliceStoreService<CollectorState, CollectorState, unknown>
>()('@specter-ts/observability/CollectorStore') {}
