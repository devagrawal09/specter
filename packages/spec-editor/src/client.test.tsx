// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@codemirror/lang-json', () => ({ json: () => [] }))
vi.mock('codemirror', () => ({ basicSetup: [] }))
vi.mock('@codemirror/view', () => {
  class EditorView {
    static readonly lineWrapping = {}
    static readonly editable = { of: () => ({}) }
    static readonly updateListener = { of: () => ({}) }

    constructor(options: { parent: HTMLElement }) {
      options.parent.append(document.createElement('div'))
    }

    destroy() {}
  }
  return { EditorView }
})

import { mountSpecEditor } from './client'

let dispose: (() => void) | undefined

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>'
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json([
        {
          path: 'todos/add-todo/spec.json',
          revision: 'sha256:revision',
          digest:
            'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          readOnly: false,
          document: specification(),
        },
      ]),
    ),
  )
  dispose = mountSpecEditor(requiredElement<HTMLDivElement>('#app'))
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('spec editor client', () => {
  it('keeps the active field mounted while typing', async () => {
    await vi.waitFor(() => expect(nameInput().value).toBe('addTodo'))
    const input = nameInput()
    input.focus()

    for (const character of 'Changed') {
      input.value += character
      input.dispatchEvent(new Event('input', { bubbles: true }))
      expect(document.activeElement).toBe(input)
      expect(nameInput()).toBe(input)
    }

    expect(input.value).toBe('addTodoChanged')
    expect(requiredButton('Save').disabled).toBe(false)
  })

  it('asks before replacing a dirty draft with a new Slice', async () => {
    await vi.waitFor(() => expect(nameInput().value).toBe('addTodo'))
    input(
      requiredElement<HTMLInputElement>('input[aria-label="Search Slices"]'),
      'dirty',
    )
    input(nameInput(), 'changedName')
    requiredButton('Add Slice').click()
    input(
      requiredElement<HTMLInputElement>(
        'input[placeholder="worklog/archive-task"]',
      ),
      'todos/archive-todo',
    )
    input(
      requiredElement<HTMLInputElement>('input[placeholder="archiveTask"]'),
      'archiveTodo',
    )
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    requiredButton('Create draft').click()

    expect(confirm).toHaveBeenCalledWith('Discard unsaved edits?')
    expect(nameInput().value).toBe('changedName')

    confirm.mockReturnValue(true)
    requiredButton('Create draft').click()
    expect(nameInput().value).toBe('archiveTodo')
  })
})

class FakeEventSource {
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null

  close() {}
}

function nameInput() {
  const label = [...document.querySelectorAll('label')].find(
    (candidate) => candidate.firstChild?.textContent?.trim() === 'Name',
  )
  const input = label?.querySelector('input')
  if (!(input instanceof HTMLInputElement))
    throw new Error('Missing Name input.')
  return input
}

function input(element: HTMLInputElement, value: string) {
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function requiredButton(name: string) {
  const matches = [...document.querySelectorAll('button')].filter(
    (button) => button.textContent?.trim() === name,
  )
  if (matches.length !== 1)
    throw new Error(`Expected one ${name} button, found ${matches.length}.`)
  const [button] = matches
  if (!(button instanceof HTMLButtonElement)) throw new Error('Missing button.')
  return button
}

function requiredElement<T extends Element>(selector: string) {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`Missing ${selector}.`)
  return element as T
}

function specification() {
  return {
    $schema: 'https://specter.dev/specification/v1/slice.schema.json',
    formatVersion: 1,
    kind: 'command',
    name: 'addTodo',
    description: 'Adds a todo.',
    scenarios: [
      {
        description: 'Adds one.',
        given: [],
        when: { title: 'Ship it' },
        expect: [
          {
            kind: 'scenario-event',
            eventType: 'todo-added',
            examplePayload: { title: 'Ship it' },
          },
        ],
      },
    ],
  }
}
