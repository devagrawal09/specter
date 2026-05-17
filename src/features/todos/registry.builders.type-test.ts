import { z } from 'zod'

import {
  createCommandSlice,
  createProjectionSlice,
  createReactionSlice,
} from './registry.builders'

const commandSchema = z.object({
  title: z.string(),
})

const projectionSchema = z.object({
  status: z.enum(['all', 'active', 'completed']),
})

export const validCommandRegistration = createCommandSlice('typeCheckCommand')
  .schema(commandSchema)
  .decide((command, _tx) => [
    {
      type: 'todoAdded',
      payload: { todoId: command.title, title: command.title },
    },
  ])

export const validCommandWithApplyRegistration = createCommandSlice(
  'typeCheckStatefulCommand',
)
  .schema(commandSchema)
  .apply(() => {})
  .decide((command, _tx) => [
    {
      type: 'todoAdded',
      payload: { todoId: command.title, title: command.title },
    },
  ])

export const validProjectionRegistration = createProjectionSlice(
  'typeCheckProjection',
)
  .schema(projectionSchema)
  .apply(() => {})
  .component(() => null)

export const validReactionRegistration = createReactionSlice(
  'typeCheckReaction',
).react(() => [
  {
    type: 'addTodo',
    payload: { title: 'From reaction' },
  },
])

export const validReactionWithApplyRegistration = createReactionSlice(
  'typeCheckStatefulReaction',
)
  .apply(() => {})
  .react(() => [])

// @ts-expect-error schema must be called before decide
createCommandSlice('missingSchema').decide(() => [])

// @ts-expect-error schema must be called before apply
createCommandSlice('missingSchemaBeforeApply').apply(() => {})

createProjectionSlice('missingProjectionApply')
  .schema(projectionSchema)
  // @ts-expect-error projection apply must be called before component
  .component(() => null)

// @ts-expect-error reaction must use react instead of decide
createReactionSlice('missingReactionReact').decide(() => [])

createCommandSlice('inferredCommand')
  .schema(commandSchema)
  .decide((command, _tx) => {
    // @ts-expect-error command is inferred from the schema
    command.missing

    return []
  })
