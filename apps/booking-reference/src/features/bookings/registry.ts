import type { CommandRef, QueryRef } from '@specter-ts/core'
import { sqliteEventLog } from '../../db/specter-sqlite'
import { reactionScheduler } from '../../reaction-scheduler'
import approveBooking from './approve-booking/slice'
import approvalNotificationReaction from './approval-notification-reaction/slice'
import bookingActivityQuery from './booking-activity-query/slice'
import cancelBooking from './cancel-booking/slice'
import checkInBooking from './check-in-booking/slice'
import createRoom from './create-room/slice'
import { bookingEventDefinitions } from './events'
import pendingApprovalsQuery from './pending-approvals-query/slice'
import recordApprovalNotification from './record-approval-notification/slice'
import rejectBooking from './reject-booking/slice'
import releaseRoom from './release-room/slice'
import requestBooking from './request-booking/slice'
import rescheduleBooking from './reschedule-booking/slice'
import retireRoom from './retire-room/slice'
import roomScheduleQuery from './room-schedule-query/slice'

export const bookingRegistrations = [
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
] as const

export const bookingSpecterAppConfig = {
  events: bookingEventDefinitions,
  eventLog: sqliteEventLog,
  scheduler: reactionScheduler,
  slices: bookingRegistrations,
} as const

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
