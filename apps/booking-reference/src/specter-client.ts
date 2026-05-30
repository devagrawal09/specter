import { defineSpecterClient } from '@specter-ts/core/client'

import type { bookingSpecterAppConfig } from './features/bookings/registry'

type BookingSpecterAppConfig = typeof bookingSpecterAppConfig

export const specterClient =
  defineSpecterClient<BookingSpecterAppConfig>('/api')
