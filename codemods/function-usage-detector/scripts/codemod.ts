import type { Codemod, SgNode } from 'codemod:ast-grep'
import type TSX from 'codemod:ast-grep/langs/tsx'
import { useMetricAtom } from 'codemod:metrics'
import { acquireLock, getState, setState } from 'codemod:workflow'
import {
  REPORT_STATE_KEY,
  type DirectCallSite,
  type FunctionUsageFinding,
} from './report.ts'

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
  const fileFindings: FunctionUsageFinding[] = []

  for (const candidate of functionCandidates(root.root())) {
    const lineCount = codeLineCount(candidate.body)
    const usage = usageEvidence(candidate.name)
    const callSiteCount = usage.callSites.length
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
    const location = candidate.name.range()

    fileFindings.push({
      id: `${filename}:${line}:${location.start.column + 1}:${candidate.name.text()}`,
      function: {
        name: candidate.name.text(),
        kind: candidate.kind,
      },
      location: {
        file: filename,
        line,
        column: location.start.column + 1,
        endLine: location.end.line + 1,
        endColumn: location.end.column + 1,
      },
      body: {
        codeLines: lineCount,
      },
      usage: {
        directCallSites: callSiteCount,
        distinctDirectCallers: new Set(
          usage.callSites.map((call) =>
            `${call.file}:${call.caller.line ?? 'top-level'}:${call.caller.name}`,
          ),
        ).size,
        resolvedReferences: usage.resolvedReferences,
        nonCallReferences: usage.resolvedReferences - callSiteCount,
        callSites: usage.callSites,
      },
      matchedReasons: [
        ...(isShort ? (['short'] as const) : []),
        ...(hasFewCallSites ? (['few-call-sites'] as const) : []),
      ],
    })

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

  if (fileFindings.length > 0) {
    const release = acquireLock(REPORT_STATE_KEY)
    try {
      const accumulated = getState<FunctionUsageFinding[]>(REPORT_STATE_KEY) ?? []
      setState(REPORT_STATE_KEY, [...accumulated, ...fileFindings])
    } finally {
      release()
    }
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

function usageEvidence(name: SgNode<TSX>) {
  const callSites = new Set<string>()
  const evidence: DirectCallSite[] = []
  let resolvedReferences = 0

  for (const fileReferences of name.references()) {
    for (const reference of fileReferences.nodes) {
      resolvedReferences += 1
      const call = directInvocation(reference)
      if (!call) continue

      const key = `${fileReferences.root.relativeFilename()}:${call.range().start.index}`
      if (callSites.has(key)) continue
      callSites.add(key)

      const caller = enclosingCaller(call)
      evidence.push({
        file: fileReferences.root.relativeFilename(),
        line: call.range().start.line + 1,
        column: call.range().start.column + 1,
        caller,
      })
    }
  }

  return {
    callSites: evidence.sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        left.line - right.line ||
        left.column - right.column,
    ),
    resolvedReferences,
  }
}

function enclosingCaller(call: SgNode<TSX>): DirectCallSite['caller'] {
  for (const ancestor of call.ancestors()) {
    if (ancestor.kind() === 'function_declaration') {
      return {
        kind: 'function',
        name: ancestor.field('name')?.text() ?? '<anonymous>',
        line: ancestor.range().start.line + 1,
      }
    }
    if (
      ancestor.kind() === 'arrow_function' ||
      ancestor.kind() === 'function_expression'
    ) {
      const declarator = ancestor.parent()
      return {
        kind: 'function',
        name:
          declarator?.kind() === 'variable_declarator'
            ? (declarator.field('name')?.text() ?? '<anonymous>')
            : '<anonymous>',
        line: ancestor.range().start.line + 1,
      }
    }
    if (ancestor.kind() === 'method_definition' || ancestor.kind() === 'method_signature') {
      return {
        kind: 'function',
        name: ancestor.field('name')?.text() ?? '<method>',
        line: ancestor.range().start.line + 1,
      }
    }
  }

  return { kind: 'top-level', name: '<top-level>', line: null }
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
