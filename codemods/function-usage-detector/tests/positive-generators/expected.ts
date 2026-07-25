export function* rareGenerator(value: number) {
  const first = value + 1
  const second = first + 1
  yield second
}

rareGenerator(1)

export const rareGeneratorExpression = function* internalGenerator(value: number) {
  const first = value + 1
  const second = first + 1
  yield second
}

rareGeneratorExpression(1)
