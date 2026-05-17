import { z } from 'zod'

import { createCommandSlice, createProjectionSlice } from './registry.builders'

const commandSchema = z.object({
  title: z.string(),
})

const projectionSchema = z.object({
  status: z.enum(['all', 'active', 'completed']),
})

export const validCommandRegistration = createCommandSlice('typeCheckCommand')
  .schema(commandSchema)
  .decide((_tx, command) => [
    {
      type: 'todoAdded',
      payload: { todoId: command.title, title: command.title },
    },
  ])

export const validCommandWithApplyEventsRegistration = createCommandSlice(
  'typeCheckStatefulCommand',
)
  .schema(commandSchema)
  .applyEvents(() => {})
  .decide((_tx, command) => [
    {
      type: 'todoAdded',
      payload: { todoId: command.title, title: command.title },
    },
  ])

export const validProjectionRegistration = createProjectionSlice(
  'typeCheckProjection',
)
  .schema(projectionSchema)
  .applyEvents(() => {})
  .component(() => null)

// @ts-expect-error schema must be called before decide
createCommandSlice('missingSchema').decide(() => [])

// @ts-expect-error schema must be called before applyEvents
createCommandSlice('missingSchemaBeforeApply').applyEvents(() => {})

createProjectionSlice('missingProjectionApply')
  .schema(projectionSchema)
  // @ts-expect-error projection applyEvents must be called before component
  .component(() => null)

createCommandSlice('inferredCommand')
  .schema(commandSchema)
  .decide((_tx, command) => {
    // @ts-expect-error command is inferred from the schema
    command.missing

    return []
  })
