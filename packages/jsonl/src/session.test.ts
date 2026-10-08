import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createEventDefinition,
  createSpecterApp,
  implementCommand,
  implementQuery,
  implementReaction,
  type SliceStoreService,
} from '@specter-ts/core'
import { createImmediateReactionSchedulerLayer } from '@specter-ts/memory'
import {
  createCommandSlice,
  createQuerySlice,
  createReactionSlice,
  event,
} from '@specter-ts/spec'
import { Context, Effect, Layer } from 'effect'
import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'

import { createJsonlEventLogLayer } from './event-log'
import { createJsonlSliceStoreLayer } from './slice-store'

type NotesState = { notes: string[]; latest?: string }
const createNotesState = (): NotesState => ({ notes: [] })
const NotesStore = Context.Service<
  SliceStoreService<NotesState, NotesState, unknown>
>('@specter/jsonl/test/NotesStore')

const noteAdded = createEventDefinition(
  'note-added',
  z.object({ noteId: z.string() }),
)

const addNote = implementCommand(
  createCommandSlice('addNote')
    .description('Adds a note.')
    .scenarios({
      description: 'Adds the note.',
      given: [],
      when: { noteId: 'n1' },
      expect: [event('note-added', { noteId: 'n1' })],
    }),
)
  .inputSchema(z.object({ noteId: z.string() }))
  .store(NotesStore)
  .handle(async (command) => [noteAdded.create(command)])

const notes = implementQuery(
  createQuerySlice('notes')
    .description('Lists notes.')
    .scenarios({
      description: 'Lists one note.',
      given: [event('note-added', { noteId: 'n1' })],
      when: {},
      expect: ['n1'],
    }),
)
  .inputSchema(z.object({}))
  .outputSchema<string[]>()
  .store(NotesStore)
  .apply(noteAdded, async ({ payload }, state) => {
    state.notes.push(payload.noteId)
  })
  .handle(async (_query, state) => state.notes)

const delivered: string[] = []

const announceNote = implementReaction(
  createReactionSlice('announceNote')
    .description('Announces each added note outside Specter.')
    .scenarios({
      description: 'Announces the note.',
      given: [event('note-added', { noteId: 'n1' })],
      expect: [{ noteId: 'n1' }],
    }),
)
  .outputSchema<{ noteId: string }>()
  .plugin(() =>
    Effect.succeed((output) =>
      Effect.sync(() => {
        delivered.push(output.noteId)
      }),
    ),
  )
  .store(NotesStore)
  .apply(noteAdded, async ({ payload }, state) => {
    state.latest = payload.noteId
  })
  .handle(async (state) =>
    state.latest ? { noteId: state.latest } : undefined,
  )

const config = {
  events: [noteAdded],
  slices: { addNote, notes, announceNote },
} as const

const directories: string[] = []

afterEach(() => {
  delivered.length = 0
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('reopens an app without rerunning Reaction effects', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'specter-jsonl-session-'))
  directories.push(directory)
  const open = () =>
    createSpecterApp(
      config,
      Layer.mergeAll(
        createJsonlEventLogLayer({ path: join(directory, 'events.jsonl') }),
        createJsonlSliceStoreLayer(NotesStore, createNotesState, {
          directory: join(directory, 'slices'),
        }),
        createImmediateReactionSchedulerLayer(),
      ),
    )

  const first = await open()
  for (const noteId of ['n1', 'n2']) {
    const execution = await first.command({
      type: 'addNote',
      payload: { noteId },
    })
    await execution.reactions
  }
  expect(await first.query({ type: 'notes', payload: {} })).toEqual([
    'n1',
    'n2',
  ])
  await first.close()
  expect(delivered).toEqual(['n1', 'n2'])

  const reopened = await open()
  expect(await reopened.query({ type: 'notes', payload: {} })).toEqual([
    'n1',
    'n2',
  ])
  expect(delivered).toEqual(['n1', 'n2'])
  const execution = await reopened.command({
    type: 'addNote',
    payload: { noteId: 'n3' },
  })
  await execution.reactions
  await reopened.close()
  expect(delivered).toEqual(['n1', 'n2', 'n3'])
  // addNote applies no Events, so it never publishes a cursor or a file.
  expect(readdirSync(join(directory, 'slices')).sort()).toEqual([
    'announceNote.json',
    'notes.json',
  ])
})
