import { createSpecterBrowserTransport } from './transport/specter-browser'
import type {
  CommandExecutionOptions,
  SpecterCommandEnvelope,
} from '@specter-ts/core'

import type { TodoSpecterAppConfig } from './features/todos/registry'

export const specterTransport =
  createSpecterBrowserTransport<TodoSpecterAppConfig>('/api')

export async function runSpecterCommand(
  envelope: SpecterCommandEnvelope<TodoSpecterAppConfig>,
  options?: CommandExecutionOptions,
) {
  const execution = await specterTransport.command(envelope, options)
  await execution.reactions
  return execution
}
