import type { JsonValue } from '@specter-ts/spec'

const uppercaseWords = new Set(['api', 'id', 'ids', 'url', 'urls'])

export type SemanticValue =
  | {
      readonly kind: 'scalar'
      readonly text: string
      readonly tone: 'boolean' | 'empty' | 'number' | 'text'
    }
  | {
      readonly kind: 'list'
      readonly items: readonly SemanticValue[]
    }
  | {
      readonly kind: 'record'
      readonly fields: readonly {
        readonly label: string
        readonly value: SemanticValue
      }[]
    }

export function humanizeLabel(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  return words
    .map((word, index) => {
      const lower = word.toLowerCase()
      if (uppercaseWords.has(lower)) return lower.toUpperCase()
      return index === 0
        ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`
        : lower
    })
    .join(' ')
}

export function presentValue(value: JsonValue): SemanticValue {
  if (value === null) return { kind: 'scalar', text: 'None', tone: 'empty' }
  if (typeof value === 'boolean')
    return {
      kind: 'scalar',
      text: value ? 'Yes' : 'No',
      tone: 'boolean',
    }
  if (typeof value === 'number')
    return { kind: 'scalar', text: String(value), tone: 'number' }
  if (typeof value === 'string')
    return { kind: 'scalar', text: value, tone: 'text' }
  if (Array.isArray(value))
    return { kind: 'list', items: value.map(presentValue) }

  return {
    kind: 'record',
    fields: Object.entries(value).map(([key, fieldValue]) => ({
      label: humanizeLabel(key),
      value: presentValue(fieldValue),
    })),
  }
}
