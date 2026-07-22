import { describe, expect, it, vi } from 'vitest'

import { SegmentCoordinator } from './segment-coordinator'

type TestSegment = { readonly id: string }

describe('SegmentCoordinator', () => {
  it('serializes concurrent rotation and opens one replacement', async () => {
    const open = vi.fn(async () => ({ id: 'replacement' }))
    const close = vi.fn()
    const retire = vi.fn()
    const coordinator = new SegmentCoordinator<TestSegment>({
      initial: { id: 'initial' },
      shouldRotate: (segment) => segment.id === 'initial',
      open,
      retire,
      close,
    })

    const [first, second] = await Promise.all([
      coordinator.acquire(),
      coordinator.acquire(),
    ])

    expect(open).toHaveBeenCalledTimes(1)
    expect(first.segment).toBe(second.segment)
    expect(retire).toHaveBeenCalledWith({ id: 'initial' })
    expect(close).toHaveBeenCalledWith({ id: 'initial' })
    first.release()
    second.release()
    await coordinator.shutdown()
    expect(close).toHaveBeenCalledWith({ id: 'replacement' })
  })

  it('does not close a retired segment while a request still uses it', async () => {
    let rotate = false
    const close = vi.fn()
    const coordinator = new SegmentCoordinator<TestSegment>({
      initial: { id: 'initial' },
      shouldRotate: () => rotate,
      open: async () => ({ id: 'replacement' }),
      retire: vi.fn(),
      close,
    })
    const inFlight = await coordinator.acquire()
    rotate = true

    const replacement = await coordinator.acquire()
    expect(replacement.segment.id).toBe('replacement')
    expect(close).not.toHaveBeenCalledWith({ id: 'initial' })

    inFlight.release()
    expect(close).toHaveBeenCalledWith({ id: 'initial' })
    replacement.release()
    await coordinator.shutdown()
  })
})
