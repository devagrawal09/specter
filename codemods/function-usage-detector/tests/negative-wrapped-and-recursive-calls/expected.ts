type NumberFunction = (value: number) => number

export function wrappedCalls(value: number) {
  const doubled = value * 2
  const shifted = doubled + 1
  return shifted / 3
}

wrappedCalls!(1)
;(wrappedCalls as NumberFunction)(2)
;(wrappedCalls satisfies NumberFunction)(3)

export const recursiveExpression = function inner(value: number) {
  if (value <= 0) return 0
  const next = value - 1
  return inner(next)
}

recursiveExpression(3)
recursiveExpression(2)
