import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  canonicalizeSpecification,
  createCommandSlice,
  createQuerySlice,
  createReactionSlice,
  declareSpecification,
  digestSpecification,
  event,
  parseSpecification,
  parseSpecificationJson,
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
  it('declares each kind with its name, and a Command with its rejection codes', () => {
    expect(declareSpecification(specification)).toContain(
      'declare const specification: CommandSliceDeclaration<"addTodo", never>',
    )
    expect(
      declareSpecification(
        createQuerySlice('todosQuery').description('Lists todos.').scenarios({
          description: 'Lists none.',
          given: [],
          when: {},
          expect: [],
        }),
      ),
    ).toContain(
      'import type { QuerySliceDeclaration } from \'@specter-ts/spec\'\n\ndeclare const specification: QuerySliceDeclaration<"todosQuery">',
    )
    expect(
      declareSpecification(
        createReactionSlice('cheer')
          .description('Cheers.')
          .scenarios({ description: 'Cheers none.', given: [], expect: [] }),
      ),
    ).toContain('ReactionSliceDeclaration<"cheer">')
  })

  it('serializes deterministically and computes a canonical digest', () => {
    expect(serializeSpecification(specification)).toContain(
      '"formatVersion": 2',
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

  it('requires a kebab-case code for rejected Command scenarios', () => {
    const rejected = (reject: unknown) =>
      parseSpecification({
        ...specification,
        scenarios: [{ ...specification.scenarios[0], expect: [], reject }],
      })
    expect(() =>
      parseSpecification({
        ...specification,
        scenarios: [{ ...specification.scenarios[0], expect: [] }],
      }),
    ).toThrow('define a rejection code')
    expect(() => rejected({ message: 'Todo exists' })).toThrow(
      '$.scenarios[0].reject.code is required',
    )
    expect(() => rejected({ code: 'Todo exists' })).toThrow(
      '$.scenarios[0].reject.code must use kebab-case',
    )
    expect(() => rejected({ code: 'todo-exists', reason: 'x' })).toThrow(
      '$.scenarios[0].reject.reason is not allowed',
    )
    expect(() => rejected({ code: 'todo-exists', message: ' ' })).toThrow(
      '$.scenarios[0].reject.message must be a non-empty string',
    )
    expect(
      rejected({
        code: 'todo-exists',
        message: 'Todo exists',
        details: { todoId: '1' },
      }).scenarios[0],
    ).toMatchObject({
      reject: {
        code: 'todo-exists',
        message: 'Todo exists',
        details: { todoId: '1' },
      },
    })
    expect(rejected({ code: 'todo-exists' }).scenarios[0]).toMatchObject({
      reject: { code: 'todo-exists' },
    })
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
      'sha256:6310d825b7fcdce1aea7d3127a5b78a7794e9ab92d585dafcb2b1f8853ad5337',
    )
  })

  it('matches the shared ECMAScript Unicode string vector', () => {
    const fixture = readFileSync(
      new URL(
        '../../../specification/fixtures/unicode-strings.spec.json',
        import.meta.url,
      ),
      'utf8',
    )
    const parsed = parseSpecificationJson(fixture)
    const canonical = canonicalizeSpecification(parsed)

    expect(canonical).toContain('\u2028')
    expect(canonical).toContain('\u2029')
    expect(JSON.parse(canonical).scenarios[0].when.literalEscapes).toBe(
      '\\u2028 and \\u2029',
    )
    expect(digestSpecification(parsed)).toBe(
      'sha256:20e59e607bb0c6d2111a45d6e15a7e0e8e0e588773b9ef1c6b7710f9445724e2',
    )
  })

  it('rejects the shared unpaired-surrogate vector', () => {
    const fixture = readFileSync(
      new URL(
        '../../../specification/fixtures/invalid-lone-surrogate.spec.json',
        import.meta.url,
      ),
      'utf8',
    )

    expect(() => parseSpecificationJson(fixture)).toThrow(
      'unpaired UTF-16 surrogate',
    )
  })
})
