import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'

const protocolRoot = new URL('../../../protocol/', import.meta.url)
const schemaNames = [
  'json-value.schema.json',
  'envelope.schema.json',
  'messages.schema.json',
  'runtime-observation.schema.json',
] as const
const schemas = schemaNames.map((name) =>
  JSON.parse(readFileSync(new URL(`schemas/${name}`, protocolRoot), 'utf8')),
)
const specificationRoot = new URL('../../../specification/', import.meta.url)
const specificationSchema = JSON.parse(
  readFileSync(new URL('schemas/slice.schema.json', specificationRoot), 'utf8'),
)

describe('normative Draft 2020-12 schemas', () => {
  it('validates the language-neutral Slice fixture and rejects schema drift', () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL('fixtures/add-todo.spec.json', specificationRoot),
        'utf8',
      ),
    )
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
      specificationSchema,
    )

    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true)
    expect(validate({ ...fixture, implementation: 'typescript' })).toBe(false)
  })

  it('validates shared fixtures with a real Draft 2020-12 engine', () => {
    const ajv = new Ajv2020({
      allErrors: true,
      strict: true,
      // Message variants inherit their object constraint from the envelope.
      strictTypes: false,
      // Cross-branch exclusions refer to sibling properties by design.
      strictRequired: false,
    })
    addFormats(ajv)
    ajv.addSchema(specificationSchema)
    for (const schema of schemas) {
      expect(schema).toMatchObject({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
      })
      ajv.addSchema(schema)
    }
    const validate = ajv.getSchema(
      'https://specter.dev/protocol/v1/messages.schema.json',
    )
    expect(validate).toBeDefined()

    const manifest = JSON.parse(
      readFileSync(new URL('fixtures/manifest.json', protocolRoot), 'utf8'),
    ) as {
      readonly cases: readonly {
        readonly file: string
        readonly name: string
        readonly valid: boolean
      }[]
    }
    const behaviorOnlyInvalid = new Set([
      'invalid-causality-range.json',
      'invalid-event-ordering.json',
      'invalid-specification-digest.json',
    ])

    for (const fixture of manifest.cases) {
      const input = readFileSync(
        new URL(`fixtures/${fixture.file}`, protocolRoot),
        'utf8',
      )
      let value: unknown
      try {
        value = JSON.parse(input)
      } catch {
        expect(fixture.valid, fixture.name).toBe(false)
        continue
      }
      // Draft 2020-12 cannot compare sibling values or recompute a content
      // digest. Runtime validators enforce those behavioral constraints.
      const schemaValid = fixture.valid || behaviorOnlyInvalid.has(fixture.file)
      expect(validate?.(value), fixture.name).toBe(schemaValid)
    }
  })
})
