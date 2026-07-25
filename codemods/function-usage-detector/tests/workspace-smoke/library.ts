export function crossFilePopular(value: number) {
  return value + 1
}

export function crossFileRare(value: number) {
  const doubled = value * 2
  const shifted = doubled + 1
  return shifted / 3
}
