import { desc } from 'drizzle-orm'
import { createServerFn } from '@tanstack/solid-start'

import { db } from '../db/client.server'
import { notes } from '../db/schema'

function validateCreateNoteInput(data: unknown) {
  if (!data || typeof data !== 'object') {
    throw new Error('Expected note input')
  }

  const input = data as { title?: unknown; body?: unknown }
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const body = typeof input.body === 'string' ? input.body.trim() : ''

  if (!title) {
    throw new Error('Title is required')
  }

  return { title, body }
}

export const listNotes = createServerFn({ method: 'GET' }).handler(async () => {
  return db.select().from(notes).orderBy(desc(notes.createdAt))
})

export const createNote = createServerFn({ method: 'POST' })
  .inputValidator(validateCreateNoteInput)
  .handler(async ({ data }) => {
    const now = new Date()

    const note = db
      .insert(notes)
      .values({
        title: data.title,
        body: data.body,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()

    return note
  })
