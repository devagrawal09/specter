export type ControllerSnapshot = {
  connected: boolean
  label: string
  pushToTalk: boolean
}

export function watchController(input: {
  onChange(snapshot: ControllerSnapshot): void
  onConfirm(): void
  onBack(): void
  onNavigate(direction: -1 | 1): void
  onPushToTalk(active: boolean): void
}) {
  let frame = 0
  let previousButtons: boolean[] = []
  let previousAxis = 0
  let previousTrigger = false
  let lastLabel = ''

  const tick = () => {
    const gamepad = [...(navigator.getGamepads?.() ?? [])].find(Boolean)
    if (!gamepad) {
      if (lastLabel) {
        lastLabel = ''
        input.onChange({
          connected: false,
          label: 'No controller',
          pushToTalk: false,
        })
      }
      frame = requestAnimationFrame(tick)
      return
    }

    const buttons = gamepad.buttons.map((button) => button.pressed)
    const trigger = Boolean(buttons[6])
    const axis =
      Math.abs(gamepad.axes[1] ?? 0) > 0.65
        ? Math.sign(gamepad.axes[1] ?? 0)
        : 0
    const up = Boolean(buttons[12])
    const down = Boolean(buttons[13])
    if (buttons[0] && !previousButtons[0]) input.onConfirm()
    if (buttons[1] && !previousButtons[1]) input.onBack()
    if ((down && !previousButtons[13]) || (axis === 1 && previousAxis !== 1))
      input.onNavigate(1)
    if ((up && !previousButtons[12]) || (axis === -1 && previousAxis !== -1))
      input.onNavigate(-1)
    if (trigger !== previousTrigger) input.onPushToTalk(trigger)

    if (lastLabel !== gamepad.id || trigger !== previousTrigger) {
      lastLabel = gamepad.id
      input.onChange({
        connected: true,
        label: gamepad.id,
        pushToTalk: trigger,
      })
    }
    previousButtons = buttons
    previousAxis = axis
    previousTrigger = trigger
    frame = requestAnimationFrame(tick)
  }

  const connected = () => {
    if (!frame) frame = requestAnimationFrame(tick)
  }
  window.addEventListener('gamepadconnected', connected)
  frame = requestAnimationFrame(tick)
  return () => {
    cancelAnimationFrame(frame)
    window.removeEventListener('gamepadconnected', connected)
  }
}

export async function pulseController(duration = 120, magnitude = 0.35) {
  const gamepad = [...(navigator.getGamepads?.() ?? [])].find(Boolean)
  const actuator = gamepad?.vibrationActuator
  if (!actuator?.playEffect) return false
  await actuator.playEffect('dual-rumble', {
    duration,
    strongMagnitude: magnitude,
    weakMagnitude: magnitude,
  })
  return true
}
