import { describe, expect, it } from 'vitest'
import {
  canonicalizeSpecification,
  createCommandSlice,
  digestSpecification,
  event,
  parseSpecification,
  serializeSpecification,
} from './index.ts'

const specification = createCommandSlice('addTodo')
  .description('Adds a todo.')
  .scenarios({
    description: 'Adds one.',
    given: [],
    when: { id: '1' },
    expect: [event('todo-added', { id: '1' })],
  })

describe('portable Slice specification', () => {
  it('serializes deterministically and computes a canonical digest', () => {
    expect(serializeSpecification(specification)).toContain(
      '"formatVersion": 1',
    )
    expect(digestSpecification(specification)).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('rejects unknown fields and non-portable values', () => {
    expect(() => parseSpecification({ ...specification, extra: true })).toThrow(
      '$.extra is not allowed',
    )
    expect(() =>
      parseSpecification({
        ...specification,
        scenarios: [
          { ...specification.scenarios[0], when: { value: new Date() } },
        ],
      }),
    ).toThrow('must be a plain object')
    const sparse = Array.from({ length: 1 }) as unknown[]
    delete sparse[0]
    expect(() =>
      parseSpecification({
        ...specification,
        scenarios: [{ ...specification.scenarios[0], when: sparse }],
      }),
    ).toThrow('sparse array hole')
    const withSymbol = { value: true, [Symbol('private')]: true }
    expect(() =>
      parseSpecification({
        ...specification,
        scenarios: [{ ...specification.scenarios[0], when: withSymbol }],
      }),
    ).toThrow('symbol-keyed')
  })

  it('requires exact reasons for rejected Command scenarios', () => {
    expect(() =>
      parseSpecification({
        ...specification,
        scenarios: [{ ...specification.scenarios[0], expect: [] }],
      }),
    ).toThrow('define an exact rejection reason')
  })

  it('uses UTF-16 key ordering for cross-language canonical digests', () => {
    const unicode = createCommandSlice('unicodeVector')
      .description('Exercises canonical JSON ordering.')
      .scenarios({
        description: 'Sorts keys without locale rules.',
        given: [],
        when: { '\u20ac': 3, '\r': 0, '\ud83d\ude00': 4, '\u00f6': 2, '1': 1 },
        expect: [event('unicode-recorded', { value: true })],
      })
    const canonical = canonicalizeSpecification(unicode)

    expect(canonical.indexOf('"\\r"')).toBeLessThan(canonical.indexOf('"1"'))
    expect(canonical.indexOf('"1"')).toBeLessThan(canonical.indexOf('"ö"'))
    expect(canonical.indexOf('"ö"')).toBeLessThan(canonical.indexOf('"€"'))
    expect(canonical.indexOf('"€"')).toBeLessThan(canonical.indexOf('"😀"'))
    expect(digestSpecification(unicode)).toBe(
      'sha256:55b5fb1832af7eb3a48eb72f161765c1b07f95c04bad0e10204c7d477e018b1c',
    )
  })
})
