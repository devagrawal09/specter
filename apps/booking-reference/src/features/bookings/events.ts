import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const roomCreatedEvent = createEventDefinition(
  'roomCreated',
  z.object({
    roomId: z.string(),
    name: z.string(),
    capacity: z.number().int().positive(),
    location: z.string(),
  }),
)

export const roomRetiredEvent = createEventDefinition(
  'roomRetired',
  z.object({
    roomId: z.string(),
  }),
)

export const bookingRequestedEvent = createEventDefinition(
  'bookingRequested',
  z.object({
    bookingId: z.string(),
    roomId: z.string(),
    requesterEmail: z.string(),
    requesterName: z.string(),
    purpose: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
  }),
)

export const bookingApprovedEvent = createEventDefinition(
  'bookingApproved',
  z.object({
    bookingId: z.string(),
    approverEmail: z.string(),
    approverName: z.string(),
  }),
)

export const bookingRejectedEvent = createEventDefinition(
  'bookingRejected',
  z.object({
    bookingId: z.string(),
    approverEmail: z.string(),
    approverName: z.string(),
    reason: z.string(),
  }),
)

export const bookingRescheduledEvent = createEventDefinition(
  'bookingRescheduled',
  z.object({
    bookingId: z.string(),
    roomId: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
  }),
)

export const bookingCanceledEvent = createEventDefinition(
  'bookingCanceled',
  z.object({
    bookingId: z.string(),
    canceledByEmail: z.string(),
    reason: z.string(),
  }),
)

export const bookingCheckedInEvent = createEventDefinition(
  'bookingCheckedIn',
  z.object({
    bookingId: z.string(),
    checkedInByEmail: z.string(),
  }),
)

export const roomReleasedEvent = createEventDefinition(
  'roomReleased',
  z.object({
    bookingId: z.string(),
    releasedByEmail: z.string(),
  }),
)

export const approvalNotificationRecordedEvent = createEventDefinition(
  'approvalNotificationRecorded',
  z.object({
    bookingId: z.string(),
    message: z.string(),
  }),
)

export const bookingEventDefinitions = [
  roomCreatedEvent,
  roomRetiredEvent,
  bookingRequestedEvent,
  bookingApprovedEvent,
  bookingRejectedEvent,
  bookingRescheduledEvent,
  bookingCanceledEvent,
  bookingCheckedInEvent,
  roomReleasedEvent,
  approvalNotificationRecordedEvent,
] as const
