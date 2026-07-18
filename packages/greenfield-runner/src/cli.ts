#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  buildFrozenProvenance,
  expandCoordinatorCatalog,
  toAdopterAssignment,
  validateCompleteMatrix,
} from './coordinator.js'
import {
  beginRemediation,
  finishRemediation,
  freezeFirstAttempt,
  freezeRemediation,
  prepareAttempt,
  recordMarker,
  runVerificationSuite,
  startActiveTime,
  stopActiveTime,
} from './runner.js'
import { writeAggregateReport, writeAttemptReport } from './report.js'
import { rehearseAdopterAccessIsolation } from './isolation.js'
import { stableJson } from './storage.js'
import type { MarkerOutcome, SuiteKind } from './types.js'

const [command, ...rawArgs] = process.argv.slice(2)

try {
  const args = parseOptions(rawArgs)
  let result: unknown
  switch (command) {
    case 'prepare':
      result = {
        attemptDirectory: prepareAttempt({
          attemptsRoot: required(args, 'attempts-root'),
          assignment: jsonFile(required(args, 'assignment')),
          provenance: jsonFile(required(args, 'provenance')),
        }),
      }
      break
    case 'timer-start':
      result = startActiveTime(required(args, 'attempt'))
      break
    case 'timer-stop':
      result = stopActiveTime(required(args, 'attempt'))
      break
    case 'mark': {
      const kind = required(args, 'kind')
      if (kind !== 'bootstrap' && kind !== 'checkpoint') {
        throw new Error('--kind must be bootstrap or checkpoint')
      }
      result = recordMarker(
        required(args, 'attempt'),
        kind,
        markerOutcome(required(args, 'outcome')),
        args.note,
      )
      break
    }
    case 'freeze':
      result = freezeFirstAttempt(
        required(args, 'attempt'),
        markerOutcome(required(args, 'outcome')),
        args.note,
      )
      break
    case 'verify':
      result = await runVerificationSuite(
        required(args, 'attempt'),
        suiteKind(required(args, 'suite')),
      )
      break
    case 'remediation-start':
      result = beginRemediation(required(args, 'attempt'))
      break
    case 'remediation-freeze':
      result = freezeRemediation(required(args, 'attempt'))
      break
    case 'remediation-finish': {
      result = finishRemediation(
        required(args, 'attempt'),
        required(args, 'result'),
        args.note,
      )
      break
    }
    case 'report':
      result = writeAttemptReport(required(args, 'attempt'))
      break
    case 'aggregate':
      result = writeAggregateReport(required(args, 'attempts-root'))
      break
    case 'expand-catalog':
      result = expandCoordinatorCatalog(jsonFile(required(args, 'catalog')))
      break
    case 'validate-matrix':
      result = validateCompleteMatrix(jsonFile(required(args, 'matrix')))
      break
    case 'adopter-assignment': {
      const matrix = validateCompleteMatrix(jsonFile(required(args, 'matrix')))
      const attemptId = required(args, 'attempt-id')
      const entry = matrix.find(
        (candidate) => candidate.attemptId === attemptId,
      )
      if (!entry) throw new Error(`Unknown attempt ID: ${attemptId}`)
      result = toAdopterAssignment(entry)
      break
    }
    case 'build-provenance':
      result = buildFrozenProvenance(jsonFile(required(args, 'config')))
      break
    case 'rehearse-isolation': {
      const isolationResult = rehearseAdopterAccessIsolation(
        jsonFile(required(args, 'contract')),
      )
      result = isolationResult
      if (!isolationResult.passed) process.exitCode = 1
      break
    }
    case 'help':
    case undefined:
      console.log(help())
      process.exit(0)
      break
    default:
      throw new Error(`Unknown command: ${command}`)
  }
  console.log(stableJson(result))
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause))
  process.exitCode = 1
}

function parseOptions(rawArgs: readonly string[]): Record<string, string> {
  const options: Record<string, string> = {}
  for (let index = 0; index < rawArgs.length; index += 2) {
    const flag = rawArgs[index]
    const value = rawArgs[index + 1]
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error('Options must be explicit --name value pairs')
    }
    const name = flag.slice(2)
    if (options[name] !== undefined) {
      throw new Error(`Duplicate option: ${flag}`)
    }
    options[name] = value
  }
  return options
}

function required(options: Record<string, string>, name: string): string {
  const value = options[name]
  if (!value) throw new Error(`Missing --${name}`)
  return value
}

function jsonFile(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as unknown
}

function markerOutcome(value: string): MarkerOutcome {
  if (value === 'passed' || value === 'failed' || value === 'time-expired') {
    return value
  }
  throw new Error('--outcome must be passed, failed, or time-expired')
}

function suiteKind(value: string): SuiteKind {
  if (value === 'visible' || value === 'held-out') return value
  throw new Error('--suite must be visible or held-out')
}

function help(): string {
  return `specter-greenfield commands:
  prepare --attempts-root DIR --assignment FILE --provenance FILE
  timer-start --attempt DIR
  timer-stop --attempt DIR
  mark --attempt DIR --kind bootstrap|checkpoint --outcome OUTCOME [--note TEXT]
  freeze --attempt DIR --outcome OUTCOME [--note TEXT]
  verify --attempt DIR --suite visible|held-out
  remediation-start --attempt DIR
  remediation-freeze --attempt DIR
  remediation-finish --attempt DIR --result verifier-result.json [--note TEXT]
  report --attempt DIR
  aggregate --attempts-root DIR
  expand-catalog --catalog FILE
  validate-matrix --matrix FILE
  adopter-assignment --matrix FILE --attempt-id ID
  build-provenance --config FILE
  rehearse-isolation --contract FILE`
}
