export type SegmentLease<Segment> = {
  readonly segment: Segment
  release(): void
}

type SegmentSlot<Segment> = {
  readonly segment: Segment
  references: number
  retired: boolean
}

export type SegmentCoordinatorOptions<Segment> = {
  readonly initial: Segment
  readonly shouldRotate: (segment: Segment) => boolean
  readonly open: () => Promise<Segment>
  readonly retire: (segment: Segment) => void
  readonly close: (segment: Segment) => void
}

/**
 * Serializes segment replacement and keeps retired segments alive until every
 * request that captured them has finished.
 */
export class SegmentCoordinator<Segment> {
  readonly #options: SegmentCoordinatorOptions<Segment>
  readonly #slots = new Set<SegmentSlot<Segment>>()
  #active: SegmentSlot<Segment>
  #gate: Promise<void> = Promise.resolve()
  #closing = false
  #closedResolve: (() => void) | undefined
  #shutdownPromise: Promise<void> | undefined

  constructor(options: SegmentCoordinatorOptions<Segment>) {
    this.#options = options
    this.#active = this.#slot(options.initial)
  }

  async acquire(): Promise<SegmentLease<Segment>> {
    return this.#serialize(async () => {
      if (this.#closing) throw new Error('Segment coordinator is closed')
      if (this.#options.shouldRotate(this.#active.segment)) {
        const next = this.#slot(await this.#options.open())
        const previous = this.#active
        this.#active = next
        previous.retired = true
        this.#options.retire(previous.segment)
        this.#closeIfUnused(previous)
      }

      const slot = this.#active
      slot.references += 1
      let released = false
      return {
        segment: slot.segment,
        release: () => {
          if (released) return
          released = true
          slot.references -= 1
          this.#closeIfUnused(slot)
        },
      }
    })
  }

  shutdown(): Promise<void> {
    this.#shutdownPromise ??= this.#shutdown()
    return this.#shutdownPromise
  }

  async #shutdown(): Promise<void> {
    await this.#serialize(async () => {
      this.#closing = true
      this.#active.retired = true
      this.#options.retire(this.#active.segment)
      this.#closeIfUnused(this.#active)
    })
    if (this.#slots.size === 0) return
    await new Promise<void>((resolve) => {
      this.#closedResolve = resolve
      if (this.#slots.size === 0) this.#resolveClosed()
    })
  }

  #slot(segment: Segment): SegmentSlot<Segment> {
    const slot = { segment, references: 0, retired: false }
    this.#slots.add(slot)
    return slot
  }

  #closeIfUnused(slot: SegmentSlot<Segment>) {
    if (!slot.retired || slot.references !== 0 || !this.#slots.has(slot)) return
    try {
      this.#options.close(slot.segment)
    } finally {
      this.#slots.delete(slot)
      if (this.#closing && this.#slots.size === 0) this.#resolveClosed()
    }
  }

  #resolveClosed() {
    this.#closedResolve?.()
    this.#closedResolve = undefined
  }

  async #serialize<Result>(action: () => Promise<Result>): Promise<Result> {
    const previous = this.#gate
    let unlock!: () => void
    this.#gate = new Promise<void>((resolve) => {
      unlock = resolve
    })
    await previous
    try {
      return await action()
    } finally {
      unlock()
    }
  }
}
