import { defineSpecterClient } from '@specter-ts/core/client'

import type { narayanSpecterAppConfig } from './features/narayan/registry'

type NarayanSpecterAppConfig = typeof narayanSpecterAppConfig

export const specterClient =
  defineSpecterClient<NarayanSpecterAppConfig>('/api/specter')
