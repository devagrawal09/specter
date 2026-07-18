export function terminateProcessTree(
  pid: number,
  signal: NodeJS.Signals,
): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Process ID must be a positive safe integer: ${pid}`)
  }
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, signal)
      return
    } catch (cause) {
      if (!isMissingProcess(cause)) throw cause
    }
  }
  try {
    process.kill(pid, signal)
  } catch (cause) {
    if (!isMissingProcess(cause)) throw cause
  }
}

function isMissingProcess(cause: unknown): boolean {
  return cause instanceof Error && 'code' in cause && cause.code === 'ESRCH'
}
