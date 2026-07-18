#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  expandCoordinatorCatalog,
  validateCompleteMatrix,
} from '../packages/greenfield-runner/dist/index.js'
import { validateVerificationPlan } from '../packages/greenfield-verifier/dist/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evaluationRoot = resolve(root, 'docs/evaluations/greenfield-adoption')

const readJson = (path) =>
  JSON.parse(readFileSync(resolve(root, path), 'utf8'))

const matrix = readJson(
  'docs/evaluations/greenfield-adoption/matrix.json',
)
const semanticCatalog = readJson(
  'docs/evaluations/greenfield-adoption/semantic-catalog.json',
)
const checkCatalog = readJson(
  'docs/evaluations/greenfield-adoption/coordinator/check-catalog.json',
)
const executionCatalog = readJson(
  'docs/evaluations/greenfield-adoption/coordinator/execution-catalog.template.json',
)
const planTemplate = readJson(
  'docs/evaluations/greenfield-adoption/templates/verification-plan.json',
)

const fail = (message) => {
  throw new Error(`Greenfield contract validation failed: ${message}`)
}

const unique = (values, label) => {
  if (new Set(values).size !== values.length) fail(`${label} must be unique`)
}

const exactSet = (actual, expected, label) => {
  const left = [...actual].sort()
  const right = [...expected].sort()
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    fail(`${label} differ: ${left.join(', ')} != ${right.join(', ')}`)
  }
}

if (matrix.schemaVersion !== 1 || matrix.domains?.length !== 5) {
  fail('matrix must contain exactly five version-1 domains')
}

const matrixIds = matrix.domains.map((domain) => domain.id)
unique(matrixIds, 'matrix domain IDs')
unique(
  matrix.domains.map((domain) => domain.port),
  'matrix ports',
)

const semanticDomainIds = semanticCatalog.domains.map((domain) => domain.id)
const checkDomainIds = checkCatalog.domainBindings.map(
  (domain) => domain.domainId,
)
const executionDomainIds = executionCatalog.domains.map(
  (domain) => domain.domainId,
)
exactSet(semanticDomainIds, matrixIds, 'semantic and matrix domain IDs')
exactSet(checkDomainIds, matrixIds, 'check and matrix domain IDs')
exactSet(executionDomainIds, matrixIds, 'execution and matrix domain IDs')

const probesByDomain = new Map()
const allSemanticIds = []
for (const domain of semanticCatalog.domains) {
  const probes = new Map()
  for (const probe of domain.probes) {
    if (probes.has(probe.semanticId)) {
      fail(`${domain.id} duplicates semantic ID ${probe.semanticId}`)
    }
    if (!probe.semanticId.startsWith(`${domain.id}.`)) {
      fail(`${probe.semanticId} is outside domain ${domain.id}`)
    }
    probes.set(probe.semanticId, probe)
    allSemanticIds.push(probe.semanticId)
  }
  probesByDomain.set(domain.id, probes)
}
unique(allSemanticIds, 'global semantic IDs')

const expectedCapabilityByRole = {
  checkpointCommand: 'command',
  primaryQuery: 'query',
  detailQuery: 'query',
  eventLog: 'eventLog',
  browserJourneyA: 'browser',
  browserJourneyB: 'browser',
  reactionTriggerCommand: 'command',
  reactionEffectCommand: 'command',
  reactionDelivery: 'reactionDelivery',
  idempotencyCommand: 'command',
  concurrentCommand: 'command',
  processControl: 'processControl',
  restart: 'restart',
  replay: 'replay',
  projectionFault: 'faultInjection',
  reactionFault: 'faultInjection',
  outbox: 'outbox',
  subscription: 'subscription',
}

const matrixById = new Map(matrix.domains.map((domain) => [domain.id, domain]))
const executionById = new Map(
  executionCatalog.domains.map((domain) => [domain.domainId, domain]),
)
for (const domain of checkCatalog.domainBindings) {
  const matrixDomain = matrixById.get(domain.domainId)
  const executionDomain = executionById.get(domain.domainId)
  const probes = probesByDomain.get(domain.domainId)
  if (!matrixDomain || !executionDomain || !probes) {
    fail(`missing ${domain.domainId}`)
  }
  const persistence =
    matrixDomain.persistence.adapter === 'postgresql' ? 'postgres' : 'sqlite'
  if (
    executionDomain.persistence !== persistence ||
    executionDomain.port !== matrixDomain.port ||
    executionDomain.domainKind !==
      (matrixDomain.cohort === 'near-transfer'
        ? 'transfer'
        : matrixDomain.cohort)
  ) {
    fail(`${domain.domainId} execution facts drift from matrix.json`)
  }
  for (const [role, semanticId] of Object.entries(domain.roleBindings)) {
    const expectedCapability = expectedCapabilityByRole[role]
    if (!expectedCapability) {
      fail(`${domain.domainId} has unknown role ${role}`)
    }
    const probe = probes.get(semanticId)
    if (!probe) {
      fail(`${domain.domainId}.${role} references missing ${semanticId}`)
    }
    if (probe.capability !== expectedCapability) {
      fail(
        `${domain.domainId}.${role} expects ${expectedCapability}, got ${probe.capability}`,
      )
    }
  }
  for (const definition of checkCatalog.definitions) {
    if (
      definition.appliesTo !== 'all' &&
      definition.appliesTo !== persistence
    ) {
      continue
    }
    for (const role of definition.semanticRoles) {
      if (!(role in domain.roleBindings)) {
        fail(`${definition.check.id} lacks ${domain.domainId}.${role} binding`)
      }
    }
  }
}

const expanded = validateCompleteMatrix(
  expandCoordinatorCatalog(executionCatalog),
)
if (expanded.length !== 10) fail('execution catalog did not produce ten attempts')

for (const matrixDomain of matrix.domains) {
  const persistence =
    matrixDomain.persistence.adapter === 'postgresql' ? 'postgres' : 'sqlite'
  const plan = structuredClone(planTemplate)
  plan.attempt.id = `${matrixDomain.id}-1`
  plan.attempt.domain = matrixDomain.id
  plan.attempt.persistence = persistence
  plan.attempt.topology =
    persistence === 'postgres' ? 'multiProcess' : 'singleProcess'
  plan.attempt.port = matrixDomain.port
  if (persistence === 'postgres') {
    delete plan.attempt.firstAttempt.persistentHarnessFirstUse
    for (const phase of plan.attempt.firstAttempt.phases) {
      phase.generatorInvocations = phase.generatorInvocations.filter(
        (invocation) => invocation.generator !== 'persistentHarness',
      )
    }
  }
  plan.checks = checkCatalog.definitions
    .filter(
      (definition) =>
        definition.appliesTo === 'all' ||
        definition.appliesTo === persistence,
    )
    .map((definition) => definition.check)
  validateVerificationPlan(plan)
}

console.log(
  `Greenfield contracts valid: ${matrixIds.length} domains, ${expanded.length} attempts, ${allSemanticIds.length} semantic IDs, ${checkCatalog.definitions.length} checks`,
)
