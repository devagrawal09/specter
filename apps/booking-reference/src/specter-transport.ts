import { createSpecterBrowserTransport } from './transport/specter-browser'
import type {
  CommandExecutionOptions,
  SpecterCommandEnvelope,
} from '@specter-ts/core'

import type { BookingSpecterAppConfig } from './features/bookings/registry'

export const specterTransport =
  createSpecterBrowserTransport<BookingSpecterAppConfig>('/api')

export async function runSpecterCommand(
  envelope: SpecterCommandEnvelope<BookingSpecterAppConfig>,
  options?: CommandExecutionOptions,
) {
  const execution = await specterTransport.command(envelope, options)
  await execution.reactions
  return execution
}
