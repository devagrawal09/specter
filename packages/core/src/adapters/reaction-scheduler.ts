export type ReactionScheduler = {
  bind: (run: () => Promise<void>) => {
    request: () => void
    waitForIdle: () => Promise<void>
  }
}
