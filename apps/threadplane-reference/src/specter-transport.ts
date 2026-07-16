import { createSpecterBrowserTransport } from './transport/specter-browser'
import type {
  CommandExecutionOptions,
  SpecterCommandEnvelope,
} from '@specter-ts/core'

import type { threadplaneReferenceSpecterAppConfig } from './features/threadplane/registry'

type ThreadplaneSpecterAppConfig = typeof threadplaneReferenceSpecterAppConfig

export const specterTransport =
  createSpecterBrowserTransport<ThreadplaneSpecterAppConfig>('/api/specter')

export async function runSpecterCommand(
  envelope: SpecterCommandEnvelope<ThreadplaneSpecterAppConfig>,
  options?: CommandExecutionOptions,
) {
  const execution = await specterTransport.command(envelope, options)
  await execution.reactions
  return execution
}
