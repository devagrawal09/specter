export function shortButPopular(value: number) {
  return value + 1
}

shortButPopular(1)
shortButPopular(2)
shortButPopular(3)

export function longButRare(value: number) {
  const doubled = value * 2
  const shifted = doubled + 1
  return shifted / 3
}

longButRare(1)

export function shortAndRare() {
  return 23
}
