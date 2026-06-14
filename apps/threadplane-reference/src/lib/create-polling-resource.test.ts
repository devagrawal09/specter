import { createRoot, createSignal } from 'solid-js'
import { expect, test, vi } from 'vitest'

import { createPollingResource } from './create-polling-resource'

const startTransitionSpy = vi.hoisted(() => vi.fn())

vi.mock('solid-js', async (importActual) => {
  const solid = await importActual<typeof import('solid-js')>()

  return {
    ...solid,
    startTransition: (callback: () => void) => {
      startTransitionSpy(callback)
      return solid.startTransition(callback)
    },
  }
})

const flush = () => Promise.resolve().then(() => Promise.resolve())

test('polls immediately, preserves data, and stops on cleanup', async () => {
  vi.useFakeTimers()

  let dispose!: () => void
  const [activeSource, setActiveSource] = createSignal('alpha')
  const fetcher = vi.fn(async (value: string) => `${value}:${Date.now()}`)

  const [resource] = createRoot((d) => {
    dispose = d
    return createPollingResource(activeSource, fetcher, {
      intervalMs: 5000,
    })
  })

  await flush()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(resource()).toMatch(/^alpha:/)

  vi.advanceTimersByTime(5000)
  await flush()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(resource()).toMatch(/^alpha:/)

  setActiveSource('beta')
  await flush()
  expect(fetcher).toHaveBeenCalledTimes(3)

  dispose()
  vi.advanceTimersByTime(10000)
  await flush()
  expect(fetcher).toHaveBeenCalledTimes(3)

  vi.useRealTimers()
})

test('runs polling refetches inside a transition', async () => {
  vi.useFakeTimers()
  startTransitionSpy.mockClear()

  let dispose!: () => void
  const fetcher = vi.fn(async (value: string) => value)

  createRoot((d) => {
    dispose = d
    createPollingResource(() => 'alpha', fetcher, { intervalMs: 1000 })
  })

  await flush()
  expect(startTransitionSpy).not.toHaveBeenCalled()

  vi.advanceTimersByTime(1000)
  await flush()

  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(startTransitionSpy).toHaveBeenCalledTimes(1)

  dispose()
  vi.useRealTimers()
})

test('skips polling when disabled or source is invalid', async () => {
  vi.useFakeTimers()

  const [current, setCurrent] = createSignal<string | undefined>(undefined)
  const fetcher = vi.fn(async (value: string) => value)

  let dispose!: () => void
  createRoot((d) => {
    dispose = d
    createPollingResource(current, fetcher, { enabled: true, intervalMs: 1000 })
  })

  await flush()
  expect(fetcher).toHaveBeenCalledTimes(0)

  setCurrent('ready')
  await flush()
  expect(fetcher).toHaveBeenCalledTimes(1)

  vi.advanceTimersByTime(1000)
  await flush()
  expect(fetcher).toHaveBeenCalledTimes(2)

  dispose()

  vi.useRealTimers()
})
