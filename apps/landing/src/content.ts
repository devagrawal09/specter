export type WorkbenchCard = {
  tag: string
  name: string
  kind: string
  summary: string
  context: string
}

export const sliceCards: WorkbenchCard[] = [
  {
    tag: 'command',
    name: 'requestBooking',
    kind: 'Command Slice',
    summary: 'Decides whether a Command may append domain Events.',
    context: 'Owns private decision state derived from relevant Events.',
  },
  {
    tag: 'query',
    name: 'roomScheduleQuery',
    kind: 'Query Slice',
    summary: 'Answers one Query from its own event-derived state.',
    context: 'Applies relevant Events; its Query handler only reads.',
  },
  {
    tag: 'reaction',
    name: 'approvalNotificationReaction',
    kind: 'Reaction Slice',
    summary: 'Observes committed Events and may produce one typed output.',
    context: 'A Reaction Plugin interprets the output after validation.',
  },
]

export const supportCards: WorkbenchCard[] = [
  {
    tag: 'spec',
    name: 'requestBookingSpec',
    kind: 'Slice Specification',
    summary: 'Records the immutable name, description, and exact scenarios.',
    context: 'Imports only the specification API and domain constants.',
  },
  {
    tag: 'plugin',
    name: 'notificationPlugin',
    kind: 'Reaction Plugin',
    summary: 'Interprets a Reaction output against another boundary.',
    context: 'Can dispatch a Command or call an external service.',
  },
]

export const workbenchCards = [...sliceCards, ...supportCards]

export const installCommand = 'npm create specter@latest my-app'

export const commandSpecCode = `import { createCommandSlice, event } from '@specter-ts/core/spec'

const requestBookingSpec = createCommandSlice('requestBooking')
  .description('Requests a room booking for approval.')
  .scenarios({
    description: 'Requests a booking for an available room.',
    given: [
      event('room-created', {
        roomId: 'room-1',
        name: 'Library',
        capacity: 6,
        location: 'Floor 1',
      }),
    ],
    when: {
      bookingId: 'booking-1',
      roomId: 'room-1',
      requesterEmail: 'ada@example.com',
      requesterName: 'Ada',
      purpose: 'Planning',
      startsAt: '2026-06-01T09:00:00.000Z',
      endsAt: '2026-06-01T10:00:00.000Z',
    },
    expect: [
      event('booking-requested', {
        bookingId: 'booking-1',
        roomId: 'room-1',
        requesterEmail: 'ada@example.com',
        requesterName: 'Ada',
        purpose: 'Planning',
        startsAt: '2026-06-01T09:00:00.000Z',
        endsAt: '2026-06-01T10:00:00.000Z',
      }),
    ],
  })

export default requestBookingSpec`

export const commandImplementationCode = `import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { bookingRequestedEvent, roomCreatedEvent } from '../events'
import requestBookingSpec from './spec'

const requestBooking = requestBookingSpec
  .inputSchema(
    z.object({
      bookingId: z.string().min(1),
      roomId: z.string().min(1),
      requesterEmail: z.string().email(),
      requesterName: z.string(),
      purpose: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
    }),
  )
  .store(sqliteSliceStore)
  .apply(roomCreatedEvent, async (event, db) => {
    await rememberRoom(db, event.payload)
  })
  .handle(async (command, db) => {
    if (!(await roomIsAvailable(db, command.roomId))) {
      throw new Error('Room is not available')
    }

    return [bookingRequestedEvent.create(command)]
  })

export default requestBooking`

export const scenarioTestCode = `import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { bookingEventDefinitions } from './events'
import { bookingRegistrations } from './registry'

testSliceImplementations(bookingRegistrations, {
  events: bookingEventDefinitions,
  runScenario: sqliteScenario({}),
})`

export const scenarioTestOutput = `✓ Requests a booking for an available room.
✓ Returns rooms with bookings for the requested day.
✓ Requests notification recording for an approved booking.

Scenario descriptions are reported as the implementation tests.`

export const eventLogCode = `order  recorded              type                            payload
─────  ────────────────────  ──────────────────────────────  ─────────────────────────
    1  2026-06-01T08:00:00Z  room-created                    { roomId: 'room-1', … }
    2  2026-06-01T08:04:12Z  booking-requested               { bookingId: 'booking-1', … }
    3  2026-06-01T08:09:41Z  booking-approved                { bookingId: 'booking-1', … }
    4  2026-06-01T08:09:42Z  approval-notification-recorded  { bookingId: 'booking-1', … }

Log IDs, order, and recorded timestamps are metadata outside Event payloads.`
