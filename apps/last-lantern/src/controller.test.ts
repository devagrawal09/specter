import { afterEach, expect, test, vi } from 'vitest'

import { watchController } from './controller'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('releases push-to-talk on disconnect, blur, page hide, and cleanup', () => {
  let nextFrame: FrameRequestCallback | undefined
  let pads: Array<Gamepad | null> = []
  const windowEvents = new EventTarget()
  const documentEvents = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
  })
  vi.stubGlobal('window', windowEvents)
  vi.stubGlobal('document', documentEvents)
  vi.stubGlobal('navigator', { getGamepads: () => pads })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrame = callback
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())

  const pushToTalk: boolean[] = []
  const stop = watchController({
    onChange: vi.fn(),
    onConfirm: vi.fn(),
    onBack: vi.fn(),
    onNavigate: vi.fn(),
    onPushToTalk: (active) => pushToTalk.push(active),
  })

  pads = [gamepad(true)]
  runFrame()
  pads = []
  runFrame()
  expect(pushToTalk).toEqual([true, false])

  pads = [gamepad(true)]
  runFrame()
  windowEvents.dispatchEvent(new Event('blur'))
  expect(pushToTalk).toEqual([true, false, true, false])

  runFrame()
  documentEvents.visibilityState = 'hidden'
  documentEvents.dispatchEvent(new Event('visibilitychange'))
  expect(pushToTalk).toEqual([true, false, true, false, true, false])

  documentEvents.visibilityState = 'visible'
  runFrame()
  windowEvents.dispatchEvent(new Event('pagehide'))
  expect(pushToTalk).toEqual([
    true,
    false,
    true,
    false,
    true,
    false,
    true,
    false,
  ])

  runFrame()
  stop()
  expect(pushToTalk.at(-2)).toBe(true)
  expect(pushToTalk.at(-1)).toBe(false)

  function runFrame() {
    const callback = nextFrame
    nextFrame = undefined
    expect(callback).toBeTypeOf('function')
    callback?.(0)
  }
})

function gamepad(trigger: boolean) {
  const buttons = Array.from({ length: 14 }, (_, index) => ({
    pressed: index === 6 && trigger,
    touched: index === 6 && trigger,
    value: index === 6 && trigger ? 1 : 0,
  }))
  return {
    id: 'Test Controller',
    index: 0,
    connected: true,
    timestamp: 0,
    mapping: 'standard',
    axes: [0, 0],
    buttons,
    vibrationActuator: null,
  } as unknown as Gamepad
}
