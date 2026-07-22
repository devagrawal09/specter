import type { CommandRef, QueryRef } from '@specter-ts/core'
import approveBooking from './approve-booking/impl'
import approvalNotificationReaction from './approval-notification-reaction/impl'
import bookingActivityQuery from './booking-activity-query/impl'
import cancelBooking from './cancel-booking/impl'
import checkInBooking from './check-in-booking/impl'
import createRoom from './create-room/impl'
import { bookingEventDefinitions } from './events'
import pendingApprovalsQuery from './pending-approvals-query/impl'
import recordApprovalNotification from './record-approval-notification/impl'
import rejectBooking from './reject-booking/impl'
import releaseRoom from './release-room/impl'
import requestBooking from './request-booking/impl'
import rescheduleBooking from './reschedule-booking/impl'
import retireRoom from './retire-room/impl'
import roomScheduleQuery from './room-schedule-query/impl'

export const bookingRegistrations = {
  createRoom,
  retireRoom,
  requestBooking,
  approveBooking,
  rejectBooking,
  rescheduleBooking,
  cancelBooking,
  checkInBooking,
  releaseRoom,
  recordApprovalNotification,
  approvalNotificationReaction,
  roomScheduleQuery,
  pendingApprovalsQuery,
  bookingActivityQuery,
} as const

export const bookingSpecterAppConfig = {
  events: bookingEventDefinitions,
  slices: bookingRegistrations,
} as const

export type BookingSpecterAppConfig = typeof bookingSpecterAppConfig

export type RoomScheduleQueryRef = QueryRef<typeof roomScheduleQuery>
export type PendingApprovalsQueryRef = QueryRef<typeof pendingApprovalsQuery>
export type BookingActivityQueryRef = QueryRef<typeof bookingActivityQuery>
export type CreateRoomRef = CommandRef<typeof createRoom>
export type RetireRoomRef = CommandRef<typeof retireRoom>
export type RequestBookingRef = CommandRef<typeof requestBooking>
export type ApproveBookingRef = CommandRef<typeof approveBooking>
export type RejectBookingRef = CommandRef<typeof rejectBooking>
export type RescheduleBookingRef = CommandRef<typeof rescheduleBooking>
export type CancelBookingRef = CommandRef<typeof cancelBooking>
export type CheckInBookingRef = CommandRef<typeof checkInBooking>
export type ReleaseRoomRef = CommandRef<typeof releaseRoom>
