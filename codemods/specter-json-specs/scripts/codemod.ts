import { parse, type Codemod, type Edit } from 'codemod:ast-grep'
import type TS from 'codemod:ast-grep/langs/typescript'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'

const builders = [
  ['createCommandSlice', 'implementCommand'],
  ['createQuerySlice', 'implementQuery'],
  ['createReactionSlice', 'implementReaction'],
] as const

const codemod: Codemod<TS> = async (root) => {
  const rootNode = root.root()
  const filename = root.filename()
  const edits: Edit[] = []

  if (filename.endsWith('/spec.ts')) {
    const legacyImports = rootNode.findAll({
      rule: { kind: 'string', regex: "^['\"]@specter-ts/core/spec['\"]$" },
    })
    edits.push(
      ...legacyImports.map((source) => ({
        startPos: source.range().start.index,
        endPos: source.range().end.index,
        insertedText: "'@specter-ts/spec'",
      })),
    )

    const hasDefault = rootNode.find({
      rule: { kind: 'export_statement', regex: '^export default' },
    })
    if (!hasDefault) {
      const builderCall = rootNode.find({
        rule: { kind: 'call_expression', has: { kind: 'identifier', regex: '^create(?:Command|Query|Reaction)Slice$' } },
      })
      const declaration = builderCall?.ancestors().find((ancestor) => ancestor.kind() === 'variable_declarator')
      const name = declaration?.field('name')?.text()
      if (name) {
        const end = rootNode.range().end.index
        edits.push({ startPos: end, endPos: end, insertedText: `\nexport default ${name}\n` })
      }
    }
    return edits.length ? rootNode.commitEdits(edits) : null
  }

  if (!filename.endsWith('/impl.ts')) return null
  const specificationImport = rootNode.find({
    rule: {
      kind: 'import_statement',
      has: { kind: 'string', regex: "^['\"]\\./spec(?:\\.js)?['\"]$" },
    },
  })
  if (!specificationImport) return null

  const metadata = specificationMetadata(join(dirname(filename), 'spec.ts'))
  if (!metadata) return null
  const localName = specificationImport
    .findAll({ rule: { kind: 'identifier' } })
    .at(-1)
    ?.text()
  if (!localName) return null

  edits.push(
    {
      startPos: specificationImport.range().start.index,
      endPos: specificationImport.range().end.index,
      insertedText: `import specification from './spec.json' with { type: 'json' }\nimport { ${metadata.implement} } from '@specter-ts/core'`,
    },
  )
  const references = rootNode.findAll({ rule: { kind: 'identifier', regex: `^${localName}$` } })
  for (const reference of references) {
    if (reference.ancestors().some((ancestor) => ancestor.kind() === 'import_statement')) continue
    edits.push({
      startPos: reference.range().start.index,
      endPos: reference.range().end.index,
      insertedText: `${metadata.implement}<'${metadata.name}'>(specification)`,
    })
  }
  return rootNode.commitEdits(edits)
}

function specificationMetadata(path: string) {
  const parsed = parse<TS>('typescript', readFileSync(path, 'utf8')).root()
  for (const [builder, implement] of builders) {
    const call = parsed.find({ rule: { pattern: `${builder}($NAME)` } })
    const literal = call?.getMatch('NAME')
    if (literal?.kind() === 'string') {
      const name = literal.text().slice(1, -1)
      if (name && name[0] === name[0]?.toLowerCase()) return { implement, name }
    }
  }
  return undefined
}

export default codemod
