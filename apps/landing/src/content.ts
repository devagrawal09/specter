export type SliceCard = {
  tag: string
  name: string
  kind: string
  summary: string
  context: string
}

export const sliceCards: SliceCard[] = [
  {
    tag: 'command',
    name: 'requestBooking',
    kind: 'Command Slice',
    summary: 'Decides which events a command should emit, or rejects it.',
    context: 'Owns one command + its decision state. Nothing else.',
  },
  {
    tag: 'state',
    name: 'roomScheduleQuery',
    kind: 'Query Slice',
    summary: 'Answers one query from an event-derived read model.',
    context: 'Reads its own state built from the log. Never mutates.',
  },
  {
    tag: 'reaction',
    name: 'approvalNotification',
    kind: 'Reaction Slice',
    summary: 'Observes new events and may emit one reaction effect.',
    context: 'Runs after command success through an explicit plugin.',
  },
  {
    tag: 'test',
    name: 'scenarios',
    kind: 'Executable Spec',
    summary: 'Given events, when input, expect events or rejection.',
    context: 'Each scenario is the local test for its own slice.',
  },
  {
    tag: 'external',
    name: 'calendarAdapter',
    kind: 'Reaction Plugin',
    summary: 'Interprets a reaction effect against an outside API.',
    context: 'Swap the plugin; the slice specification is unchanged.',
  },
]

export const installCommand = 'npm create specter'

export const commandSliceCode = `import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'
import { bookingRequestedEvent } from '../events'

const requestBooking = createCommandSlice(
  'requestBooking',
  'Requests a room for a guest and time range.',
)
  .schema(
    z.object({
      roomId: z.string(),
      guest: z.string(),
      nights: z.number().int().positive(),
    }),
  )
  .store(sqliteSliceStore)
  .scenarios(
    {
      description: 'Requests an available room.',
      given: [],
      when: { roomId: 'r-1', guest: 'Ada', nights: 2 },
      expect: [
        bookingRequestedEvent.create({
          roomId: 'r-1',
          guest: 'Ada',
          nights: 2,
        }),
      ],
    },
    {
      description: 'Rejects a room that is already held.',
      given: [bookingRequestedEvent.create({ roomId: 'r-1', guest: 'Bo', nights: 1 })],
      when: { roomId: 'r-1', guest: 'Ada', nights: 2 },
      expect: [],
      reject: { reason: 'Room is already requested' },
    },
  )
  .handle(async (command, state) => {
    if (state.isHeld(command.roomId)) {
      throw new Error('Room is already requested')
    }

    return [bookingRequestedEvent.create(command)]
  })

export default requestBooking`

export const scenarioTestCode = `import { testScenarios } from '@specter-ts/core/testing'
import { sqliteScenario } from '../../db/scenario-tests'
import { bookingRegistrations } from './registry'

// Every scenario attached to a slice runs as a behavior test.
testScenarios(bookingRegistrations, {
  runScenario: sqliteScenario({}),
})`

export const scenarioTestOutput = `✓ requestBooking > Requests an available room
✓ requestBooking > Rejects a room that is already held
✓ roomScheduleQuery > Returns rooms held for a date
✓ approvalNotification > Notifies once per approval

  4 slices · 11 scenarios · 0 unspecified paths`

export const eventLogCode = `bookingRequested   { roomId: 'r-1', guest: 'Ada', nights: 2 }
bookingApproved    { roomId: 'r-1' }
roomCheckedIn      { roomId: 'r-1' }
// append-only · ordered · replayable — state is derived, never overwritten`
