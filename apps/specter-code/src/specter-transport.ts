import { createSpecterBrowserTransport } from './transport/specter-browser'
import type {
  CommandExecutionOptions,
  SpecterCommandEnvelope,
} from '@specter-ts/core'

import type { specterCodeReferenceSpecterAppConfig } from './features/specter-code/registry'

type SpecterCodeAppConfig = typeof specterCodeReferenceSpecterAppConfig

export const specterTransport =
  createSpecterBrowserTransport<SpecterCodeAppConfig>('/api/specter')

export async function runSpecterCommand(
  envelope: SpecterCommandEnvelope<SpecterCodeAppConfig>,
  options?: CommandExecutionOptions,
) {
  const execution = await specterTransport.command(envelope, options)
  await execution.reactions
  return execution
}
