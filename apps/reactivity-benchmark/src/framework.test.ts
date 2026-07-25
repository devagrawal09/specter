import { describe, expect, it } from 'vitest'

import { createSpecterFusedSyncFramework } from './framework'

describe('Specter fused synchronous ReactiveFramework', () => {
  it('coalesces writes and runs an effect once with the settled value', () => {
    const framework = createSpecterFusedSyncFramework()
    let source: ReturnType<typeof framework.signal<number>> | undefined
    let doubled: ReturnType<typeof framework.computed<number>> | undefined
    const observed: number[] = []

    framework.withBuild(() => {
      source = framework.signal(1)
      doubled = framework.computed(() => (source?.read() as number) * 2)
      framework.effect(() => {
        observed.push(doubled?.read() as number)
      })
    })

    framework.withBatch(() => {
      source?.write(2)
      source?.write(3)
    })

    expect(doubled?.read()).toBe(6)
    expect(observed).toEqual([2, 6])
    expect(
      framework
        .inspect()
        .eventTypes.filter(
          (eventType) => eventType === 'reactive-signal-written',
        ),
    ).toHaveLength(2)
  })

  it('settles a diamond without exposing a glitch to its effect', () => {
    const framework = createSpecterFusedSyncFramework()
    const observed: number[] = []
    let head: ReturnType<typeof framework.signal<number>> | undefined

    framework.withBuild(() => {
      head = framework.signal(1)
      const left = framework.computed(() => (head?.read() as number) + 1)
      const right = framework.computed(() => (head?.read() as number) * 2)
      const sum = framework.computed(() => left.read() + right.read())
      framework.effect(() => {
        observed.push(sum.read())
      })
    })

    framework.withBatch(() => head?.write(2))

    expect(observed).toEqual([4, 7])
  })

  it('prunes downstream propagation when an intermediate value is equal', () => {
    const framework = createSpecterFusedSyncFramework()
    let head: ReturnType<typeof framework.signal<number>> | undefined
    let constantRuns = 0
    let downstreamRuns = 0
    let effectRuns = 0

    framework.withBuild(() => {
      head = framework.signal(1)
      const constant = framework.computed(() => {
        head?.read()
        constantRuns += 1
        return 0
      })
      const downstream = framework.computed(() => {
        downstreamRuns += 1
        return constant.read() + 1
      })
      framework.effect(() => {
        downstream.read()
        effectRuns += 1
      })
    })

    framework.withBatch(() => head?.write(2))

    expect(constantRuns).toBe(2)
    expect(downstreamRuns).toBe(1)
    expect(effectRuns).toBe(1)
  })

  it('switches dynamic dependencies and ignores the stale branch', () => {
    const framework = createSpecterFusedSyncFramework()
    let selector: ReturnType<typeof framework.signal<boolean>> | undefined
    let left: ReturnType<typeof framework.signal<number>> | undefined
    let selectedRuns = 0
    let selected: ReturnType<typeof framework.computed<number>> | undefined

    framework.withBuild(() => {
      selector = framework.signal(false)
      left = framework.signal(10)
      const right = framework.signal(20)
      selected = framework.computed(() => {
        selectedRuns += 1
        return selector?.read() ? right.read() : (left?.read() as number)
      })
    })

    framework.withBatch(() => selector?.write(true))
    framework.withBatch(() => left?.write(11))

    expect(selected?.read()).toBe(20)
    expect(selectedRuns).toBe(2)
  })

  it('cleans up synchronously and can build another graph', () => {
    const framework = createSpecterFusedSyncFramework()
    framework.withBuild(() => framework.signal(1))
    framework.cleanup()

    const value = framework.withBuild(() => framework.signal(2))

    expect(value.read()).toBe(2)
  })
})
