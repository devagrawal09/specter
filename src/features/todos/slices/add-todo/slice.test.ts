import { describe, expect, it } from 'vitest'

import { decideCommand } from '../../registry'
import { createTestDb } from '../../shared/test-db'

describe('add todo command slice', () => {
  it('emits a todoAdded event', () => {
    const { db, sqlite } = createTestDb()
    const [event] = decideCommand(db, {
      type: 'addTodo',
      payload: { title: 'Ship it' },
    })

    expect(event).toMatchObject({
      type: 'todoAdded',
      payload: { title: 'Ship it' },
    })
    sqlite.close()
  })

  it('trims added titles', () => {
    const { db, sqlite } = createTestDb()
    const [event] = decideCommand(db, {
      type: 'addTodo',
      payload: { title: '  Ship it  ' },
    })

    if (event.type !== 'todoAdded') {
      throw new Error(`Expected todoAdded event, received ${event.type}`)
    }

    expect(event.payload.title).toBe('Ship it')
    sqlite.close()
  })

  it('rejects blank titles', () => {
    const { db, sqlite } = createTestDb()

    expect(() =>
      decideCommand(db, { type: 'addTodo', payload: { title: '   ' } }),
    ).toThrow('Todo title is required')
    sqlite.close()
  })

  it('rejects long titles', () => {
    const { db, sqlite } = createTestDb()

    expect(() =>
      decideCommand(db, {
        type: 'addTodo',
        payload: { title: 'x'.repeat(121) },
      }),
    ).toThrow('Todo title must be 120 characters or less')
    sqlite.close()
  })
})
