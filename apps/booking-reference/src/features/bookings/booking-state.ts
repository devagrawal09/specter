export const activeBookingStatuses = ['pending', 'approved', 'checkedIn']

export function overlaps(
  startsAt: string,
  endsAt: string,
  nextStartsAt: string,
  nextEndsAt: string,
) {
  return startsAt < nextEndsAt && nextStartsAt < endsAt
}
