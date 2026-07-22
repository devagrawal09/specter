import { createQuerySlice, event } from '@specter-ts/spec'

export const todoCheersSpec = createQuerySlice('todoCheers')
  .description('Shows the latest todo cheer.')
  .scenarios(
    {
      description: 'Returns no latest cheer before any cheer is created.',
      given: [],
      when: {},
      expect: { latestCheer: null },
    },
    {
      description: 'Returns the cheer with the highest milestone.',
      given: [
        event('todo-cheer-created', {
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
        event('todo-cheer-created', {
          milestone: 10,
          message: 'Nice work: 10 todos completed.',
        }),
      ],
      when: {},
      expect: {
        latestCheer: {
          milestone: 10,
          message: 'Nice work: 10 todos completed.',
        },
      },
    },
  )

export default todoCheersSpec
