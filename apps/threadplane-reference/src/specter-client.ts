import { defineSpecterClient } from '@specter-ts/core/client'

import type { threadplaneReferenceSpecterAppConfig } from './features/threadplane/registry'

type ThreadplaneSpecterAppConfig = typeof threadplaneReferenceSpecterAppConfig

export const specterClient =
  defineSpecterClient<ThreadplaneSpecterAppConfig>('/api/specter')
