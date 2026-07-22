import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'
import { z } from 'zod'

export const todosQuery = implementQuery<'todosQuery'>(specification).inputSchema(z.object({})).outputSchema().store(store).handle(async () => [])
