import { createSpecterBrowserTransport } from './transport/specter-browser'
import type {
  CommandExecutionOptions,
  SpecterCommandEnvelope,
} from '@specter-ts/core'

import type { WorklogAppConfig } from './features/worklog/registry'

export const specterTransport =
  createSpecterBrowserTransport<WorklogAppConfig>('/api')

export async function runSpecterCommand(
  envelope: SpecterCommandEnvelope<WorklogAppConfig>,
  options?: CommandExecutionOptions,
) {
  const execution = await specterTransport.command(envelope, options)
  await execution.reactions
  return execution
}
