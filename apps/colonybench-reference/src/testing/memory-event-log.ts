import { createMemoryEventLog as createSpecterMemoryEventLog } from '@specter-ts/memory'

export function createMemoryEventLog() {
  return createSpecterMemoryEventLog({
    recordedAt: () => new Date(0).toISOString(),
  })
}
