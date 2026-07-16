import { createMemoryEventLog as createSpecterMemoryEventLog } from '@specter-ts/memory'

const resetters = new Set<() => void>()

export function createMemoryEventLog() {
  const eventLog = createSpecterMemoryEventLog({
    recordedAt: () => new Date(0).toISOString(),
  })
  resetters.add(() => eventLog.reset())
  return eventLog
}

export const memoryEventLog = createMemoryEventLog()

export function resetMemoryEventLogs() {
  for (const reset of resetters) reset()
}
