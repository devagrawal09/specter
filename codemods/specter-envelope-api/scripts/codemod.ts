import type { Codemod, Edit, SgNode } from 'codemod:ast-grep'
import type TSX from 'codemod:ast-grep/langs/tsx'

const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const codemod: Codemod<TSX> = async (root, options) => {
  const commandNames = namesFromParam(options.params.command_names)
  const queryNames = namesFromParam(options.params.query_names)
  const configuredReceivers = namesFromParam(
    options.params.receiver_names ?? 'app,specterClient,specterTransport',
  )
  const transportModule =
    options.params.transport_module ?? './transport/specter-browser'

  assertDisjoint(commandNames, queryNames)
  assertModuleSpecifier(transportModule)

  const rootNode = root.root()
  const edits: Edit[] = []
  const recognizedReceivers = new Set(configuredReceivers)
  const migratedCallIds = new Set<number>()
  const factoryBindings = migrateFactoryImport(
    rootNode,
    transportModule,
    edits,
  )

  for (const declaration of rootNode.findAll({
    rule: { kind: 'variable_declarator' },
  })) {
    const receiver = declaration.field('name')
    const value = declaration.field('value')
    const factory = value?.kind() === 'call_expression' ? value.field('function') : undefined
    if (
      receiver?.kind() === 'identifier' &&
      factory?.kind() === 'identifier' &&
      factoryBindings.has(factory.text())
    ) {
      recognizedReceivers.add(receiver.text())
    }
  }

  for (const declaration of rootNode.findAll({
    rule: { pattern: 'const $RECEIVER = await createSpecterApp($$$ARGS)' },
  })) {
    const receiver = declaration.getMatch('RECEIVER')
    if (receiver?.kind() === 'identifier') recognizedReceivers.add(receiver.text())
  }

  migrateFactoryCalls(rootNode, factoryBindings, edits)

  for (const call of rootNode.findAll({ rule: { kind: 'call_expression' } })) {
    const subscription = subscriptionCallParts(call)
    if (!subscription) continue
    const { receiver, method, args } = subscription

    if (
      !recognizedReceivers.has(receiver.text()) ||
      !queryNames.has(method.text()) ||
      (args.length !== 1 && args.length !== 2)
    ) {
      continue
    }

    const optionsArgument = args[1] ? `, ${args[1].text()}` : ''
    edits.push(
      call.replace(
        `${receiver.text()}.subscribe({ type: '${method.text()}', payload: ${args[0]?.text()} }${optionsArgument})`,
      ),
    )
    migratedCallIds.add(call.id())
  }

  for (const call of rootNode.findAll({ rule: { kind: 'call_expression' } })) {
    if (migratedCallIds.has(call.id())) continue

    const flat = flatCallParts(call)
    if (!flat) continue
    const { receiver, method, args } = flat

    if (
      !recognizedReceivers.has(receiver.text()) ||
      args.length !== 1
    ) {
      continue
    }

    const operation = method.text()
    const envelopeMethod = commandNames.has(operation)
      ? 'command'
      : queryNames.has(operation)
        ? 'query'
        : undefined

    if (!envelopeMethod) continue

    edits.push(
      call.replace(
        `${receiver.text()}.${envelopeMethod}({ type: '${operation}', payload: ${args[0]?.text()} })`,
      ),
    )
    migratedCallIds.add(call.id())
  }

  reportUnclassifiedCalls(
    rootNode,
    root.filename(),
    recognizedReceivers,
    commandNames,
    queryNames,
    migratedCallIds,
  )

  if (edits.length === 0) return null
  return rootNode.commitEdits(edits)
}

function migrateFactoryImport(
  rootNode: SgNode<TSX>,
  transportModule: string,
  edits: Edit[],
) {
  const factoryBindings = new Map<string, boolean>()
  for (const statement of rootNode.findAll({
    rule: { kind: 'import_statement' },
  })) {
    const source = statement.field('source')?.text()
    if (
      source !== "'@specter-ts/core/client'" &&
      source !== '"@specter-ts/core/client"'
    ) {
      continue
    }

    const specifiers = statement.findAll({ rule: { kind: 'import_specifier' } })
    if (specifiers.length !== 1) {
      console.warn(
        `[specter-envelope-api] ${statement.range().start.line + 1}: mixed @specter-ts/core/client import requires manual type cleanup`,
      )
      continue
    }

    const specifier = specifiers[0]
    if (!specifier) continue
    const identifiers = specifier.findAll({ rule: { kind: 'identifier' } })
    if (identifiers[0]?.text() !== 'defineSpecterClient') continue

    const localName = identifiers.at(-1)?.text() ?? 'defineSpecterClient'
    const isDirectBinding = localName === 'defineSpecterClient'
    const imported =
      isDirectBinding
        ? 'createSpecterBrowserTransport'
        : `createSpecterBrowserTransport as ${localName}`

    edits.push(
      statement.replace(
        `import { ${imported} } from '${transportModule}'`,
      ),
    )
    factoryBindings.set(localName, isDirectBinding)
  }
  return factoryBindings
}

function migrateFactoryCalls(
  rootNode: SgNode<TSX>,
  factoryBindings: ReadonlyMap<string, boolean>,
  edits: Edit[],
) {
  for (const call of rootNode.findAll({ rule: { kind: 'call_expression' } })) {
    const callee = call.field('function')
    const declaration = call.parent()
    if (
      callee?.kind() === 'identifier' &&
      factoryBindings.get(callee.text()) === true &&
      declaration?.kind() === 'variable_declarator' &&
      declaration.field('value')?.id() === call.id()
    ) {
      edits.push(callee.replace('createSpecterBrowserTransport'))
    }
  }
}

function reportUnclassifiedCalls(
  rootNode: SgNode<TSX>,
  filename: string,
  receivers: ReadonlySet<string>,
  commandNames: ReadonlySet<string>,
  queryNames: ReadonlySet<string>,
  migratedCallIds: ReadonlySet<number>,
) {
  const ignoredMethods = new Set([
    'command',
    'query',
    'subscribe',
    'then',
    'catch',
    'finally',
  ])
  const reported = new Set<string>()

  for (const call of rootNode.findAll({ rule: { kind: 'call_expression' } })) {
    const subscription = subscriptionCallParts(call)
    if (
      subscription &&
      receivers.has(subscription.receiver.text()) &&
      queryNames.has(subscription.method.text()) &&
      !migratedCallIds.has(call.id())
    ) {
      console.warn(
        `[specter-envelope-api] ${filename}:${call.range().start.line + 1} left ${subscription.receiver.text()}.subscribe.${subscription.method.text()}(...) unchanged; legacy subscriptions must have one payload and at most one options argument`,
      )
      continue
    }

    const flat = flatCallParts(call)
    if (!flat) continue
    const { receiver, method } = flat
    if (
      !receivers.has(receiver.text()) ||
      ignoredMethods.has(method.text())
    ) {
      continue
    }

    const key = `${receiver.text()}.${method.text()}`
    if (reported.has(key)) continue
    reported.add(key)
    if (commandNames.has(method.text()) || queryNames.has(method.text())) {
      if (!migratedCallIds.has(call.id())) {
        console.warn(
          `[specter-envelope-api] ${filename}:${call.range().start.line + 1} left ${key}(...) unchanged; flat operations must have exactly one payload argument`,
        )
      }
      continue
    }
    console.warn(
      `[specter-envelope-api] ${filename}:${call.range().start.line + 1} left ${key}(...) unchanged; add ${method.text()} to command_names or query_names`,
    )
  }
}

function flatCallParts(call: SgNode<TSX>) {
  const member = call.field('function')
  if (member?.kind() !== 'member_expression') return undefined

  const receiver = member.children()[0]
  const method = member.children().at(-1)
  if (
    receiver?.kind() !== 'identifier' ||
    method?.kind() !== 'property_identifier'
  ) {
    return undefined
  }

  return { receiver, method, args: callArguments(call) }
}

function subscriptionCallParts(call: SgNode<TSX>) {
  const member = call.field('function')
  if (member?.kind() !== 'member_expression') return undefined

  const subscriptionMember = member.children()[0]
  const method = member.children().at(-1)
  if (
    subscriptionMember?.kind() !== 'member_expression' ||
    method?.kind() !== 'property_identifier' ||
    subscriptionMember.children().at(-1)?.text() !== 'subscribe'
  ) {
    return undefined
  }

  const receiver = subscriptionMember.children()[0]
  if (receiver?.kind() !== 'identifier') return undefined
  return { receiver, method, args: callArguments(call) }
}

function callArguments(call: SgNode<TSX>) {
  return (
    call
      .field('arguments')
      ?.children()
      .filter((child) => !['(', ')', ','].includes(child.kind())) ?? []
  )
}

function namesFromParam(value: string | undefined) {
  const names = new Set(
    (value ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  )

  for (const name of names) {
    if (!identifierPattern.test(name)) {
      throw new Error(`Invalid Slice name in codemod parameters: ${name}`)
    }
  }

  return names
}

function assertDisjoint(
  commandNames: ReadonlySet<string>,
  queryNames: ReadonlySet<string>,
) {
  for (const name of commandNames) {
    if (queryNames.has(name)) {
      throw new Error(
        `Slice name cannot be both a command and a query: ${name}`,
      )
    }
  }
}

function assertModuleSpecifier(value: string) {
  if (!value.startsWith('.') || value.includes("'") || value.includes('\n')) {
    throw new Error(
      'transport_module must be a relative module specifier without quotes',
    )
  }
}

export default codemod
