export function eventSortOrder(event: unknown) {
  const order = (event as { order?: unknown }).order
  if (typeof order === 'number') return order

  const id = (event as { id?: unknown }).id
  const match = typeof id === 'string' ? id.match(/(\d+)$/) : undefined
  return match ? Number(match[1]) : 0
}
