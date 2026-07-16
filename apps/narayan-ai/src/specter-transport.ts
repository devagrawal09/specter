import { createSpecterBrowserTransport } from './transport/specter-browser'
import type {
  CommandExecutionOptions,
  SpecterCommandEnvelope,
} from '@specter-ts/core'

import type { narayanSpecterAppConfig } from './features/narayan/registry'

type NarayanSpecterAppConfig = typeof narayanSpecterAppConfig

export const specterTransport =
  createSpecterBrowserTransport<NarayanSpecterAppConfig>('/api/specter')

export async function runSpecterCommand(
  envelope: SpecterCommandEnvelope<NarayanSpecterAppConfig>,
  options?: CommandExecutionOptions,
) {
  const execution = await specterTransport.command(envelope, options)
  await execution.reactions
  return execution
}
