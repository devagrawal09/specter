import { defineSpecterClient } from '@specter-ts/core/client'

import type { specterCodeReferenceSpecterAppConfig } from './features/specter-code/registry'

type SpecterCodeAppConfig = typeof specterCodeReferenceSpecterAppConfig

export const specterClient =
  defineSpecterClient<SpecterCodeAppConfig>('/api/specter')
