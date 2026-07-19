import type { Codemod, SgNode } from 'codemod:ast-grep'
import type TSX from 'codemod:ast-grep/langs/tsx'
import { useMetricAtom } from 'codemod:metrics'

type FunctionCandidate = {
  body: SgNode<TSX>
  kind: 'declaration' | 'variable'
  name: SgNode<TSX>
}

const findings = useMetricAtom('function-usage-findings')

const codemod: Codemod<TSX> = async (root, options) => {
  const minimumLines = threshold(
    options.params.minimum_lines ?? '3',
    'minimum_lines',
  )
  const minimumCallSites = threshold(
    options.params.minimum_call_sites ?? '3',
    'minimum_call_sites',
  )
  const filename = root.relativeFilename()

  for (const candidate of functionCandidates(root.root())) {
    const lineCount = codeLineCount(candidate.body)
    const callSiteCount = directCallSiteCount(candidate.name)
    const isShort = lineCount < minimumLines
    const hasFewCallSites = callSiteCount < minimumCallSites

    if (!isShort && !hasFewCallSites) continue

    const reason =
      isShort && hasFewCallSites
        ? 'short-and-few-call-sites'
        : isShort
          ? 'short'
          : 'few-call-sites'
    const line = candidate.name.range().start.line + 1

    findings.increment({
      callSites: String(callSiteCount),
      file: filename,
      function: candidate.name.text(),
      kind: candidate.kind,
      line: String(line),
      lines: String(lineCount),
      reason,
    })

    console.warn(
      `[function-usage-detector] ${filename}:${line} ${candidate.name.text()} ` +
        `has ${lineCount} code line(s) and ${callSiteCount} direct call site(s); ` +
        `matched ${reason}`,
    )
  }

  return null
}

function functionCandidates(rootNode: SgNode<TSX>): FunctionCandidate[] {
  const candidates: FunctionCandidate[] = []

  for (const declaration of rootNode.findAll({
    rule: { kind: 'function_declaration' },
  })) {
    addCandidate(candidates, declaration.field('name'), declaration.field('body'), 'declaration')
  }

  for (const declarator of rootNode.findAll({
    rule: { kind: 'variable_declarator' },
  })) {
    const value = declarator.field('value')
    if (
      value?.kind() !== 'arrow_function' &&
      value?.kind() !== 'function_expression'
    ) {
      continue
    }

    addCandidate(candidates, declarator.field('name'), value.field('body'), 'variable')
  }

  return candidates
}

function addCandidate(
  candidates: FunctionCandidate[],
  name: SgNode<TSX> | null,
  body: SgNode<TSX> | null,
  kind: FunctionCandidate['kind'],
) {
  if (!name || !body) return
  if (name.kind() !== 'identifier') return

  candidates.push({ body, kind, name })
}

function codeLineCount(body: SgNode<TSX>) {
  let source = body.text()
  if (body.kind() === 'statement_block') {
    const openingBrace = source.indexOf('{')
    const closingBrace = source.lastIndexOf('}')
    if (openingBrace >= 0 && closingBrace > openingBrace) {
      source = source.slice(openingBrace + 1, closingBrace)
    }
  }

  let count = 0
  let inBlockComment = false

  for (const line of source.split(/\r?\n/)) {
    let cursor = 0
    let hasCode = false

    while (cursor < line.length) {
      if (inBlockComment) {
        const end = line.indexOf('*/', cursor)
        if (end === -1) break
        inBlockComment = false
        cursor = end + 2
        continue
      }

      while (/\s/.test(line[cursor] ?? '')) cursor += 1
      if (cursor >= line.length || line.startsWith('//', cursor)) break
      if (line.startsWith('/*', cursor)) {
        inBlockComment = true
        cursor += 2
        continue
      }

      hasCode = true
      break
    }

    if (hasCode) count += 1
  }

  return count
}

function directCallSiteCount(name: SgNode<TSX>) {
  const callSites = new Set<string>()

  for (const fileReferences of name.references()) {
    for (const reference of fileReferences.nodes) {
      const call = directInvocation(reference)
      if (!call) continue

      callSites.add(
        `${fileReferences.root.relativeFilename()}:${call.range().start.index}`,
      )
    }
  }

  return callSites.size
}

function directInvocation(reference: SgNode<TSX>) {
  let callee = reference
  let parent = callee.parent()

  while (
    parent &&
    (parent.kind() === 'parenthesized_expression' ||
      parent.kind() === 'optional_chain')
  ) {
    callee = parent
    parent = callee.parent()
  }

  if (
    parent?.kind() === 'member_expression' &&
    parent.field('property')?.id() === callee.id()
  ) {
    callee = parent
    parent = callee.parent()
  }

  if (
    parent?.kind() === 'call_expression' &&
    parent.field('function')?.id() === callee.id()
  ) {
    return parent
  }

  return null
}

function threshold(value: string, parameter: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${parameter} must be a positive integer, received ${value}`)
  }
  return parsed
}

export default codemod
