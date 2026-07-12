import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const roomCreatedEvent = createEventDefinition(
  'room-created',
  z.object({
    roomId: z.string(),
    name: z.string(),
    capacity: z.number().int().positive(),
    location: z.string(),
  }),
)

export const roomRetiredEvent = createEventDefinition(
  'room-retired',
  z.object({
    roomId: z.string(),
  }),
)

export const bookingRequestedEvent = createEventDefinition(
  'booking-requested',
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
  'booking-approved',
  z.object({
    bookingId: z.string(),
    approverEmail: z.string(),
    approverName: z.string(),
  }),
)

export const bookingRejectedEvent = createEventDefinition(
  'booking-rejected',
  z.object({
    bookingId: z.string(),
    approverEmail: z.string(),
    approverName: z.string(),
    reason: z.string(),
  }),
)

export const bookingRescheduledEvent = createEventDefinition(
  'booking-rescheduled',
  z.object({
    bookingId: z.string(),
    roomId: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
  }),
)

export const bookingCanceledEvent = createEventDefinition(
  'booking-canceled',
  z.object({
    bookingId: z.string(),
    canceledByEmail: z.string(),
    reason: z.string(),
  }),
)

export const bookingCheckedInEvent = createEventDefinition(
  'booking-checked-in',
  z.object({
    bookingId: z.string(),
    checkedInByEmail: z.string(),
  }),
)

export const roomReleasedEvent = createEventDefinition(
  'room-released',
  z.object({
    bookingId: z.string(),
    releasedByEmail: z.string(),
  }),
)

export const approvalNotificationRecordedEvent = createEventDefinition(
  'approval-notification-recorded',
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
