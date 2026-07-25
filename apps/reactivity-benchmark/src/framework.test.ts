import { describe, expect, it } from 'vitest'

import { createSpecterFusedSyncFramework } from './framework'

describe('Specter fused synchronous ReactiveFramework', () => {
  it('matches the upstream direct signal and computed contract', () => {
    const framework = createSpecterFusedSyncFramework()
    const source = framework.signal(2)
    const doubled = framework.computed(() => source.read() * 2)

    expect(doubled.read()).toBe(4)
  })

  it('supports the upstream three-build warmup before cleanup', () => {
    const framework = createSpecterFusedSyncFramework()
    const values: number[] = []

    for (let index = 0; index < 3; index += 1) {
      const update = framework.withBuild(() => {
        const source = framework.signal(index)
        const doubled = framework.computed(() => source.read() * 2)
        return () => {
          source.write(index + 1)
          values.push(doubled.read())
        }
      })
      update()
    }

    expect(values).toEqual([2, 4, 6])
    framework.cleanup()
    expect(framework.withBuild(() => framework.signal(4)).read()).toBe(4)
  })

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

  it('evaluates a forward dependency before its dependent', () => {
    const framework = createSpecterFusedSyncFramework()
    let later: ReturnType<typeof framework.computed<number>> | undefined

    const first = framework.withBuild(() => {
      const firstNode = framework.computed(() => (later?.read() as number) + 1)
      const source = framework.signal(2)
      later = framework.computed(() => source.read() * 2)
      return firstNode
    })

    expect(first.read()).toBe(5)
  })

  it('publishes no settlement events and discards the graph on callback failure', () => {
    const framework = createSpecterFusedSyncFramework()
    let source: ReturnType<typeof framework.signal<number>> | undefined

    expect(() =>
      framework.withBuild(() => {
        source = framework.signal(1)
        framework.computed(() => (source?.read() as number) * 2)
        framework.computed(() => {
          throw new Error('boom')
        })
      }),
    ).toThrow(/Reactive callback .* failed/)

    expect(framework.inspect().eventTypes).toEqual([
      'reactive-signal-created',
      'reactive-computation-created',
      'reactive-computation-created',
    ])
    expect(() => source?.write(2)).toThrow()
    expect(framework.withBuild(() => framework.signal(3)).read()).toBe(3)
  })

  it('rejects callback writes without publishing a partial settlement', () => {
    const framework = createSpecterFusedSyncFramework()

    expect(() =>
      framework.withBuild(() => {
        const source = framework.signal(1)
        framework.effect(() => source.write(2))
      }),
    ).toThrow(/Reactive callback .* failed/)

    expect(framework.inspect().eventTypes).toEqual([
      'reactive-signal-created',
      'reactive-effect-created',
    ])
  })
})
