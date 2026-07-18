import {
  evidenceKinds,
  gates,
  type CheckDefinition,
  type FirstSliceUseRecord,
  type GeneratorInvocation,
  type PhaseRecord,
  type SliceKind,
  type VerificationPlan,
} from './types.js'
import {
  canonicalEvidencePlacement,
  requiredEvidenceKinds,
} from './evidence.js'

export class PlanValidationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(
      `Invalid greenfield verification plan:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    )
    this.name = 'PlanValidationError'
    this.issues = issues
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

const isIsoTimestamp = (value: unknown): value is string =>
  isNonEmptyString(value) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
    value,
  ) &&
  !Number.isNaN(Date.parse(value))

type ChronologicalRecord = {
  timestamp?: string
  activeMinute?: number
}

function coordinateOf(
  value: ChronologicalRecord,
): { kind: 'timestamp' | 'activeMinute'; value: number } | null {
  if (value.timestamp !== undefined && value.activeMinute === undefined) {
    return isIsoTimestamp(value.timestamp)
      ? { kind: 'timestamp', value: Date.parse(value.timestamp) }
      : null
  }
  if (value.activeMinute !== undefined && value.timestamp === undefined) {
    return isFiniteNonNegative(value.activeMinute)
      ? { kind: 'activeMinute', value: value.activeMinute }
      : null
  }
  return null
}

function validateCoordinate(
  value: Record<string, unknown>,
  path: string,
  issues: string[],
): void {
  const hasTimestamp = value.timestamp !== undefined
  const hasActiveMinute = value.activeMinute !== undefined
  if (hasTimestamp === hasActiveMinute) {
    issues.push(`${path} must include exactly one of timestamp or activeMinute`)
    return
  }
  if (hasTimestamp && !isIsoTimestamp(value.timestamp)) {
    issues.push(`${path}.timestamp must be an ISO timestamp`)
  }
  if (hasActiveMinute && !isFiniteNonNegative(value.activeMinute)) {
    issues.push(`${path}.activeMinute must be a finite non-negative number`)
  }
}

function validateGenerator(
  value: unknown,
  path: string,
  issues: string[],
): value is GeneratorInvocation {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`)
    return false
  }
  if (value.generator !== 'slice' && value.generator !== 'persistentHarness') {
    issues.push(`${path}.generator must be "slice" or "persistentHarness"`)
  }
  if (value.mode !== 'dryRun' && value.mode !== 'generate') {
    issues.push(`${path}.mode must be "dryRun" or "generate"`)
  }
  if (!isNonEmptyString(value.target)) {
    issues.push(`${path}.target must be a non-empty string`)
  }
  if (typeof value.succeeded !== 'boolean') {
    issues.push(`${path}.succeeded must be a boolean`)
  }
  validateCoordinate(value, path, issues)
  if (
    !isNonEmptyString(value.transcriptSha256) ||
    !/^[a-f0-9]{64}$/.test(value.transcriptSha256)
  ) {
    issues.push(`${path}.transcriptSha256 must be 64 lowercase hex characters`)
  }
  if (value.generator === 'slice' && value.sliceKind === undefined) {
    issues.push(`${path}.sliceKind is required for Slice generation`)
  }
  if (
    value.generator === 'persistentHarness' &&
    value.sliceKind !== undefined
  ) {
    issues.push(
      `${path}.sliceKind is not allowed for persistentHarness generation`,
    )
  }
  if (
    value.sliceKind !== undefined &&
    !['command', 'query', 'reaction'].includes(String(value.sliceKind))
  ) {
    issues.push(
      `${path}.sliceKind must be command, query, or reaction when present`,
    )
  }
  if (
    value.disposition !== undefined &&
    !['kept', 'changed', 'notReused'].includes(String(value.disposition))
  ) {
    issues.push(`${path}.disposition must be kept, changed, or notReused`)
  }
  if (value.mode === 'generate' && !isNonEmptyString(value.rationale)) {
    issues.push(`${path}.rationale is required for generated output`)
  }
  if (value.mode === 'generate' && value.disposition === undefined) {
    issues.push(`${path}.disposition is required for generated output`)
  }
  return true
}

function validatePhase(
  value: unknown,
  index: number,
  issues: string[],
): value is PhaseRecord {
  const path = `attempt.firstAttempt.phases[${index}]`
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`)
    return false
  }
  if (
    !['bootstrap', 'verticalPath', 'completeApp'].includes(String(value.phase))
  ) {
    issues.push(`${path}.phase must be bootstrap, verticalPath, or completeApp`)
  }
  for (const key of ['activeMinutes', 'wallMinutes'] as const) {
    if (!isFiniteNonNegative(value[key])) {
      issues.push(`${path}.${key} must be a finite non-negative number`)
    }
  }
  if (
    !isFiniteNonNegative(value.iterations) ||
    !Number.isInteger(value.iterations)
  ) {
    issues.push(`${path}.iterations must be a non-negative integer`)
  }
  if (!Array.isArray(value.sourceConsultations)) {
    issues.push(`${path}.sourceConsultations must be an array`)
  } else {
    value.sourceConsultations.forEach((source, sourceIndex) => {
      if (
        !isRecord(source) ||
        !isNonEmptyString(source.source) ||
        !isNonEmptyString(source.reason)
      ) {
        issues.push(
          `${path}.sourceConsultations[${sourceIndex}] requires non-empty source and reason`,
        )
      }
    })
  }
  if (!Array.isArray(value.generatorInvocations)) {
    issues.push(`${path}.generatorInvocations must be an array`)
  } else {
    value.generatorInvocations.forEach((generator, generatorIndex) => {
      validateGenerator(
        generator,
        `${path}.generatorInvocations[${generatorIndex}]`,
        issues,
      )
    })
  }
  return true
}

function validateCheck(
  value: unknown,
  index: number,
  issues: string[],
): value is CheckDefinition {
  const path = `checks[${index}]`
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`)
    return false
  }
  if (
    !isNonEmptyString(value.id) ||
    !/^[a-z0-9][a-z0-9._-]*$/i.test(value.id)
  ) {
    issues.push(`${path}.id must be a non-empty stable identifier`)
  }
  if (!isNonEmptyString(value.title))
    issues.push(`${path}.title must be non-empty`)
  if (!gates.includes(value.gate as (typeof gates)[number])) {
    issues.push(`${path}.gate must be one of ${gates.join(', ')}`)
  }
  if (value.visibility !== 'visible' && value.visibility !== 'heldOut') {
    issues.push(`${path}.visibility must be visible or heldOut`)
  }
  if (typeof value.mandatory !== 'boolean') {
    issues.push(`${path}.mandatory must be a boolean`)
  }
  if (!isRecord(value.evidence)) {
    issues.push(`${path}.evidence must be an object`)
  } else {
    if (
      !evidenceKinds.includes(
        value.evidence.kind as (typeof evidenceKinds)[number],
      )
    ) {
      issues.push(`${path}.evidence.kind is not supported`)
    }
    if (!isNonEmptyString(value.evidence.description)) {
      issues.push(`${path}.evidence.description must be non-empty`)
    }
    if (
      value.evidence.additionalClaims !== undefined &&
      (!Array.isArray(value.evidence.additionalClaims) ||
        value.evidence.additionalClaims.some(
          (claim) => !isNonEmptyString(claim),
        ))
    ) {
      issues.push(
        `${path}.evidence.additionalClaims must contain non-empty strings`,
      )
    }
  }
  if (
    value.timeoutMs !== undefined &&
    (!isPositiveInteger(value.timeoutMs) || value.timeoutMs > 1_800_000)
  ) {
    issues.push(`${path}.timeoutMs must be an integer between 1 and 1800000`)
  }
  if (
    value.tags !== undefined &&
    (!Array.isArray(value.tags) ||
      value.tags.some((tag) => !isNonEmptyString(tag)))
  ) {
    issues.push(`${path}.tags must contain non-empty strings`)
  }
  return true
}

function findSuccessfulGeneratorPair(
  invocations: readonly GeneratorInvocation[],
  generator: GeneratorInvocation['generator'],
  target: string,
  sliceKind?: GeneratorInvocation['sliceKind'],
): { dryRun: GeneratorInvocation; generate: GeneratorInvocation } | null {
  const matches = (mode: GeneratorInvocation['mode']) =>
    invocations.filter(
      (entry) =>
        entry.generator === generator &&
        entry.target === target &&
        entry.sliceKind === sliceKind &&
        entry.mode === mode &&
        entry.succeeded,
    )
  for (const dryRun of matches('dryRun')) {
    const dryCoordinate = coordinateOf(dryRun)
    if (dryCoordinate === null) continue
    for (const generate of matches('generate')) {
      const generateCoordinate = coordinateOf(generate)
      if (
        generateCoordinate !== null &&
        generateCoordinate.kind === dryCoordinate.kind &&
        dryCoordinate.value < generateCoordinate.value
      ) {
        return { dryRun, generate }
      }
    }
  }
  return null
}

export function validateVerificationPlan(
  value: unknown,
): asserts value is VerificationPlan {
  const issues: string[] = []
  if (!isRecord(value))
    throw new PlanValidationError(['plan must be an object'])
  if (value.schemaVersion !== 1) issues.push('schemaVersion must be 1')

  const attempt = value.attempt
  if (!isRecord(attempt)) {
    issues.push('attempt must be an object')
  } else {
    if (!isNonEmptyString(attempt.id))
      issues.push('attempt.id must be non-empty')
    if (!isNonEmptyString(attempt.domain))
      issues.push('attempt.domain must be non-empty')
    if (
      attempt.persistence !== 'sqlite' &&
      attempt.persistence !== 'postgres'
    ) {
      issues.push('attempt.persistence must be sqlite or postgres')
    }
    if (
      attempt.topology !== 'singleProcess' &&
      attempt.topology !== 'multiProcess'
    ) {
      issues.push('attempt.topology must be singleProcess or multiProcess')
    }
    if (
      attempt.persistence === 'sqlite' &&
      attempt.topology !== 'singleProcess'
    ) {
      issues.push('SQLite attempts must use the singleProcess topology')
    }
    if (
      attempt.persistence === 'postgres' &&
      attempt.topology !== 'multiProcess'
    ) {
      issues.push('Postgres attempts must use the multiProcess topology')
    }
    if (
      !Number.isInteger(attempt.port) ||
      Number(attempt.port) < 10_000 ||
      Number(attempt.port) > 65_535
    ) {
      issues.push('attempt.port must be an integer between 10000 and 65535')
    }
    if (!isNonEmptyString(attempt.specterVersion)) {
      issues.push('attempt.specterVersion must be non-empty')
    }
    if (attempt.activeLimitMinutes !== 180) {
      issues.push(
        'attempt.activeLimitMinutes must be exactly 180 for this protocol',
      )
    }

    const firstAttempt = attempt.firstAttempt
    if (!isRecord(firstAttempt)) {
      issues.push('attempt.firstAttempt must be an object')
    } else {
      if (!isIsoTimestamp(firstAttempt.startedAt)) {
        issues.push('attempt.firstAttempt.startedAt must be an ISO timestamp')
      }
      if (!isIsoTimestamp(firstAttempt.frozenAt)) {
        issues.push('attempt.firstAttempt.frozenAt must be an ISO timestamp')
      }
      if (!isFiniteNonNegative(firstAttempt.activeMinutes)) {
        issues.push(
          'attempt.firstAttempt.activeMinutes must be finite and non-negative',
        )
      }
      if (!isFiniteNonNegative(firstAttempt.wallMinutes)) {
        issues.push(
          'attempt.firstAttempt.wallMinutes must be finite and non-negative',
        )
      }
      if (
        isFiniteNonNegative(firstAttempt.activeMinutes) &&
        isFiniteNonNegative(firstAttempt.wallMinutes) &&
        firstAttempt.activeMinutes > firstAttempt.wallMinutes
      ) {
        issues.push(
          'attempt.firstAttempt.activeMinutes must not exceed wallMinutes',
        )
      }
      if (
        !isFiniteNonNegative(firstAttempt.iterations) ||
        !Number.isInteger(firstAttempt.iterations)
      ) {
        issues.push(
          'attempt.firstAttempt.iterations must be a non-negative integer',
        )
      }
      const requiredSliceKinds: SliceKind[] = ['command', 'query', 'reaction']
      const sliceKindsUsed = firstAttempt.sliceKindsUsed
      if (!Array.isArray(sliceKindsUsed)) {
        issues.push('attempt.firstAttempt.sliceKindsUsed must be an array')
      } else if (
        sliceKindsUsed.length !== requiredSliceKinds.length ||
        requiredSliceKinds.some(
          (kind) =>
            sliceKindsUsed.filter((entry) => entry === kind).length !== 1,
        )
      ) {
        issues.push(
          'attempt.firstAttempt.sliceKindsUsed must contain exactly command, query, and reaction once each',
        )
      }
      const firstSliceUses = Array.isArray(firstAttempt.firstSliceUses)
        ? firstAttempt.firstSliceUses
        : []
      if (!Array.isArray(firstAttempt.firstSliceUses)) {
        issues.push('attempt.firstAttempt.firstSliceUses must be an array')
      }
      firstSliceUses.forEach((entry, index) => {
        const path = `attempt.firstAttempt.firstSliceUses[${index}]`
        if (!isRecord(entry)) {
          issues.push(`${path} must be an object`)
          return
        }
        if (!requiredSliceKinds.includes(entry.sliceKind as SliceKind)) {
          issues.push(`${path}.sliceKind must be command, query, or reaction`)
        }
        if (!isNonEmptyString(entry.target)) {
          issues.push(`${path}.target must be a non-empty string`)
        }
        validateCoordinate(entry, path, issues)
      })
      for (const kind of requiredSliceKinds) {
        if (
          firstSliceUses.filter(
            (entry) => isRecord(entry) && entry.sliceKind === kind,
          ).length !== 1
        ) {
          issues.push(
            `attempt.firstAttempt.firstSliceUses must contain exactly one ${kind} record`,
          )
        }
      }
      const phases = Array.isArray(firstAttempt.phases)
        ? firstAttempt.phases
        : []
      if (!Array.isArray(firstAttempt.phases)) {
        issues.push('attempt.firstAttempt.phases must be an array')
      }
      phases.forEach((phase, index) => {
        validatePhase(phase, index, issues)
      })
      const names = phases.flatMap((phase) =>
        isRecord(phase) && typeof phase.phase === 'string' ? [phase.phase] : [],
      )
      for (const phase of ['bootstrap', 'verticalPath', 'completeApp']) {
        if (names.filter((name) => name === phase).length !== 1) {
          issues.push(
            `attempt.firstAttempt.phases must contain exactly one ${phase} record`,
          )
        }
      }

      const typedPhases = phases.filter((phase): phase is PhaseRecord =>
        isRecord(phase),
      )
      const phaseActiveMinutes = typedPhases.reduce(
        (total, phase) =>
          total +
          (typeof phase.activeMinutes === 'number' ? phase.activeMinutes : 0),
        0,
      )
      const phaseIterations = typedPhases.reduce(
        (total, phase) =>
          total + (typeof phase.iterations === 'number' ? phase.iterations : 0),
        0,
      )
      if (
        typeof firstAttempt.activeMinutes === 'number' &&
        Math.abs(phaseActiveMinutes - firstAttempt.activeMinutes) > 0.001
      ) {
        issues.push(
          'attempt.firstAttempt.activeMinutes must equal the sum of phase activeMinutes',
        )
      }
      if (
        typeof firstAttempt.iterations === 'number' &&
        phaseIterations !== firstAttempt.iterations
      ) {
        issues.push(
          'attempt.firstAttempt.iterations must equal the sum of phase iterations',
        )
      }
      if (
        isIsoTimestamp(firstAttempt.startedAt) &&
        isIsoTimestamp(firstAttempt.frozenAt) &&
        Date.parse(firstAttempt.frozenAt) < Date.parse(firstAttempt.startedAt)
      ) {
        issues.push('attempt.firstAttempt.frozenAt must not precede startedAt')
      }
      const invocationList = typedPhases.flatMap((phase) =>
        Array.isArray(phase.generatorInvocations)
          ? phase.generatorInvocations
          : [],
      )
      for (const [index, invocation] of invocationList.entries()) {
        const coordinate = coordinateOf(invocation)
        if (coordinate === null) continue
        if (
          coordinate.kind === 'activeMinute' &&
          isFiniteNonNegative(firstAttempt.activeMinutes) &&
          coordinate.value > firstAttempt.activeMinutes
        ) {
          issues.push(
            `generator invocation ${index} activeMinute must not exceed first-attempt activeMinutes`,
          )
        }
        if (
          coordinate.kind === 'timestamp' &&
          isIsoTimestamp(firstAttempt.startedAt) &&
          isIsoTimestamp(firstAttempt.frozenAt) &&
          (coordinate.value < Date.parse(firstAttempt.startedAt) ||
            coordinate.value > Date.parse(firstAttempt.frozenAt))
        ) {
          issues.push(
            `generator invocation ${index} timestamp must fall within the first-attempt window`,
          )
        }
      }
      for (const kind of requiredSliceKinds) {
        const firstUse = firstSliceUses.find(
          (entry): entry is FirstSliceUseRecord =>
            isRecord(entry) && entry.sliceKind === kind,
        )
        if (firstUse === undefined) continue
        const firstUseCoordinate = coordinateOf(firstUse)
        if (
          firstUseCoordinate?.kind === 'activeMinute' &&
          isFiniteNonNegative(firstAttempt.activeMinutes) &&
          firstUseCoordinate.value > firstAttempt.activeMinutes
        ) {
          issues.push(
            `first ${kind} Slice activeMinute must not exceed first-attempt activeMinutes`,
          )
        }
        if (
          firstUseCoordinate?.kind === 'timestamp' &&
          isIsoTimestamp(firstAttempt.startedAt) &&
          isIsoTimestamp(firstAttempt.frozenAt) &&
          (firstUseCoordinate.value < Date.parse(firstAttempt.startedAt) ||
            firstUseCoordinate.value > Date.parse(firstAttempt.frozenAt))
        ) {
          issues.push(
            `first ${kind} Slice timestamp must fall within the first-attempt window`,
          )
        }
        const pair = findSuccessfulGeneratorPair(
          invocationList,
          'slice',
          firstUse.target,
          kind,
        )
        if (pair === null) {
          issues.push(
            `first ${kind} Slice target "${firstUse.target}" must have a successful dryRun before generate using the same coordinate form`,
          )
          continue
        }
        const generated = coordinateOf(pair.generate)
        const used = coordinateOf(firstUse)
        if (
          generated === null ||
          used === null ||
          generated.kind !== used.kind ||
          generated.value > used.value
        ) {
          issues.push(
            `first ${kind} Slice generation must use the first-use coordinate form and occur no later than first use`,
          )
        }
      }
      if (attempt.persistence === 'sqlite') {
        const harnessTargets = invocationList
          .filter((entry) => entry.generator === 'persistentHarness')
          .map((entry) => entry.target)
        if (
          !harnessTargets.some(
            (target) =>
              findSuccessfulGeneratorPair(
                invocationList,
                'persistentHarness',
                target,
              ) !== null,
          )
        ) {
          issues.push(
            'SQLite attempt must have a successful persistent-harness dryRun before generate using the same coordinate form',
          )
        }
        const firstUse = firstAttempt.persistentHarnessFirstUse
        if (!isRecord(firstUse)) {
          issues.push(
            'SQLite attempt requires attempt.firstAttempt.persistentHarnessFirstUse',
          )
        } else {
          if (!isNonEmptyString(firstUse.target)) {
            issues.push(
              'attempt.firstAttempt.persistentHarnessFirstUse.target must be non-empty',
            )
          }
          validateCoordinate(
            firstUse,
            'attempt.firstAttempt.persistentHarnessFirstUse',
            issues,
          )
          const pair = isNonEmptyString(firstUse.target)
            ? findSuccessfulGeneratorPair(
                invocationList,
                'persistentHarness',
                firstUse.target,
              )
            : null
          const generated = pair === null ? null : coordinateOf(pair.generate)
          const used = coordinateOf(firstUse)
          if (pair === null) {
            issues.push(
              'SQLite persistent-harness target must have a successful dryRun before generate using the same coordinate form',
            )
          } else if (
            generated === null ||
            used === null ||
            generated.kind !== used.kind ||
            generated.value > used.value
          ) {
            issues.push(
              'SQLite persistent-harness generation must use the first-use coordinate form and occur no later than first use',
            )
          }
          if (
            used?.kind === 'activeMinute' &&
            isFiniteNonNegative(firstAttempt.activeMinutes) &&
            used.value > firstAttempt.activeMinutes
          ) {
            issues.push(
              'SQLite persistent-harness first-use activeMinute must not exceed first-attempt activeMinutes',
            )
          }
          if (
            used?.kind === 'timestamp' &&
            isIsoTimestamp(firstAttempt.startedAt) &&
            isIsoTimestamp(firstAttempt.frozenAt) &&
            (used.value < Date.parse(firstAttempt.startedAt) ||
              used.value > Date.parse(firstAttempt.frozenAt))
          ) {
            issues.push(
              'SQLite persistent-harness first-use timestamp must fall within the first-attempt window',
            )
          }
        }
      } else if (firstAttempt.persistentHarnessFirstUse !== undefined) {
        issues.push(
          'Postgres attempt must not declare SQLite persistentHarnessFirstUse metadata',
        )
      }
    }

    if (attempt.remediation !== undefined) {
      if (!isRecord(attempt.remediation)) {
        issues.push('attempt.remediation must be an object when present')
      } else {
        for (const key of ['startedAt', 'frozenAt'] as const) {
          if (!isIsoTimestamp(attempt.remediation[key])) {
            issues.push(`attempt.remediation.${key} must be an ISO timestamp`)
          }
        }
        for (const key of ['activeMinutes', 'wallMinutes'] as const) {
          if (!isFiniteNonNegative(attempt.remediation[key])) {
            issues.push(
              `attempt.remediation.${key} must be finite and non-negative`,
            )
          }
        }
        if (
          !isFiniteNonNegative(attempt.remediation.iterations) ||
          !Number.isInteger(attempt.remediation.iterations)
        ) {
          issues.push(
            'attempt.remediation.iterations must be a non-negative integer',
          )
        }
        if (!Array.isArray(attempt.remediation.sourceConsultations)) {
          issues.push(
            'attempt.remediation.sourceConsultations must be an array',
          )
        } else {
          attempt.remediation.sourceConsultations.forEach((source, index) => {
            if (
              !isRecord(source) ||
              !isNonEmptyString(source.source) ||
              !isNonEmptyString(source.reason)
            ) {
              issues.push(
                `attempt.remediation.sourceConsultations[${index}] requires non-empty source and reason`,
              )
            }
          })
        }
        if (
          isFiniteNonNegative(attempt.remediation.activeMinutes) &&
          isFiniteNonNegative(attempt.remediation.wallMinutes) &&
          attempt.remediation.activeMinutes > attempt.remediation.wallMinutes
        ) {
          issues.push(
            'attempt.remediation.activeMinutes must not exceed wallMinutes',
          )
        }
      }
    }
  }

  const checks = Array.isArray(value.checks) ? value.checks : []
  if (!Array.isArray(value.checks)) issues.push('checks must be an array')
  checks.forEach((check, index) => {
    validateCheck(check, index, issues)
  })
  const typedChecks = checks.filter((check): check is CheckDefinition =>
    isRecord(check),
  )
  const ids = typedChecks.flatMap((check) =>
    typeof check.id === 'string' ? [check.id] : [],
  )
  for (const id of new Set(ids)) {
    if (ids.filter((candidate) => candidate === id).length > 1) {
      issues.push(`check id "${id}" is duplicated`)
    }
  }
  for (const check of typedChecks) {
    if (
      !isRecord(check.evidence) ||
      !evidenceKinds.includes(
        check.evidence.kind as (typeof evidenceKinds)[number],
      )
    ) {
      continue
    }
    const kind = check.evidence.kind as (typeof evidenceKinds)[number]
    const placement = canonicalEvidencePlacement[kind]
    if (
      check.gate !== placement.gate ||
      check.visibility !== placement.visibility
    ) {
      issues.push(
        `check "${String(check.id)}" evidence kind ${kind} must be ${placement.visibility} in gate ${placement.gate}`,
      )
    }
  }
  for (const gate of gates) {
    if (
      !typedChecks.some(
        (check) => check.gate === gate && check.mandatory === true,
      )
    ) {
      issues.push(`gate ${gate} requires at least one mandatory check`)
    }
  }
  for (const visibility of ['visible', 'heldOut'] as const) {
    if (!typedChecks.some((check) => check.visibility === visibility)) {
      issues.push(`checks must include at least one ${visibility} check`)
    }
  }
  for (const kind of requiredEvidenceKinds) {
    if (
      !typedChecks.some(
        (check) => check.mandatory === true && check.evidence?.kind === kind,
      )
    ) {
      issues.push(`mandatory evidence kind ${kind} is required by the protocol`)
    }
  }
  if (
    typedChecks.filter(
      (check) => check.mandatory && check.evidence?.kind === 'browserJourney',
    ).length < 2
  ) {
    issues.push('at least two mandatory browserJourney checks are required')
  }
  if (isRecord(attempt)) {
    const profileKind =
      attempt.persistence === 'sqlite'
        ? 'sqliteRecovery'
        : 'postgresSerialization'
    if (
      !typedChecks.some(
        (check) => check.mandatory && check.evidence?.kind === profileKind,
      )
    ) {
      issues.push(
        `persistence profile requires mandatory ${profileKind} evidence`,
      )
    }
    if (
      attempt.persistence === 'postgres' &&
      !typedChecks.some(
        (check) =>
          check.mandatory && check.evidence?.kind === 'postgresOutboxClaim',
      )
    ) {
      issues.push(
        'Postgres profile requires mandatory postgresOutboxClaim evidence',
      )
    }
  }

  if (issues.length > 0) throw new PlanValidationError(issues)
}

export function parseVerificationPlan(value: unknown): VerificationPlan {
  validateVerificationPlan(value)
  return value
}
