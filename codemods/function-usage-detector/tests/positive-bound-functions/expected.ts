export const conciseArrow = (value: number) => value * 2

conciseArrow(1)
conciseArrow(2)
conciseArrow(3)

export const verboseExpression = function named(value: number) {
  const first = value + 1
  const second = first + 1
  return second
}

verboseExpression(1)
