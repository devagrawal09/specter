// biome-ignore-all lint/a11y/useButtonType: The editor has no HTML forms.
import { json as jsonLanguage } from '@codemirror/lang-json'
import { EditorView } from '@codemirror/view'
import type {
  JsonValue,
  SliceSpecification,
  SpecificationDigest,
} from '@specter-ts/spec'
import { basicSetup } from 'codemirror'
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js'
import { render } from 'solid-js/web'

import './style.css'

type EditableEvent = {
  kind: 'scenario-event'
  eventType: string
  examplePayload: JsonValue
}

type EditableScenario = {
  description: string
  given: EditableEvent[]
  when?: JsonValue
  expect: JsonValue | EditableEvent[]
  reject?: { reason: string }
}

type EditableSpecification = Omit<
  SliceSpecification,
  'name' | 'description' | 'scenarios'
> & {
  name: string
  description: string
  scenarios: EditableScenario[]
}

type SpecFile = {
  path: string
  revision: string
  digest: SpecificationDigest
  readOnly: boolean
  document: EditableSpecification
}

type Draft = SpecFile & { isNew: boolean }

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('Missing #app mount point.')

render(() => <SpecEditor />, root)

function SpecEditor() {
  const [files, setFiles] = createSignal<SpecFile[]>([])
  const [draft, setDraft] = createSignal<Draft>()
  const [selectedScenario, setSelectedScenario] = createSignal(0)
  const [detailEpoch, setDetailEpoch] = createSignal(0)
  const [search, setSearch] = createSignal('')
  const [status, setStatus] = createSignal('Loading specifications…')
  const [conflict, setConflict] = createSignal(false)
  const [jsonErrors, setJsonErrors] = createSignal<Record<string, string>>({})
  const [adding, setAdding] = createSignal(false)
  const [newPath, setNewPath] = createSignal('')
  const [newName, setNewName] = createSignal('')
  const [newKind, setNewKind] = createSignal<'command' | 'query' | 'reaction'>(
    'command',
  )

  const selectedFile = createMemo(() => {
    const current = draft()
    return current?.isNew
      ? undefined
      : files().find((file) => file.path === current?.path)
  })
  const dirty = createMemo(() => {
    const current = draft()
    if (!current) return false
    if (current.isNew) return true
    return (
      JSON.stringify(current.document) !==
      JSON.stringify(selectedFile()?.document)
    )
  })
  const visibleFiles = createMemo(() => {
    const query = search().trim().toLowerCase()
    return files().filter(
      (file) =>
        !query ||
        file.document.name.toLowerCase().includes(query) ||
        file.document.description.toLowerCase().includes(query) ||
        file.path.toLowerCase().includes(query),
    )
  })
  const scenario = createMemo(
    () => draft()?.document.scenarios[selectedScenario()],
  )
  const eventNames = createMemo(() => {
    const names = new Set<string>()
    for (const file of files()) {
      for (const item of file.document.scenarios) {
        for (const event of item.given) names.add(event.eventType)
        if (file.document.kind === 'command' && Array.isArray(item.expect))
          for (const event of item.expect)
            if (isScenarioEvent(event)) names.add(event.eventType)
      }
    }
    return [...names].sort()
  })

  void loadFiles()
  const watch = new EventSource('/api/watch')
  watch.onmessage = (message) => {
    const changed = JSON.parse(message.data) as
      | { type: 'changed'; path: string }
      | { type: 'error'; message: string }
    if (changed.type === 'error') {
      setStatus(`Filesystem watch failed: ${changed.message}`)
      return
    }
    const current = draft()
    const currentSource = current?.path.replace(/spec\.json$/, 'spec.ts')
    const selectedChanged =
      changed.path === current?.path || changed.path === currentSource
    if (dirty() && selectedChanged) {
      setConflict(true)
      setStatus('A specification changed on disk. Reload before saving.')
    } else if (dirty()) void refreshFiles()
    else void loadFiles()
  }
  watch.onerror = () =>
    setStatus('Filesystem watch disconnected; reload the page.')
  onCleanup(() => watch.close())

  async function loadFiles() {
    try {
      const loaded = await request<SpecFile[]>('/api/specs')
      const currentPath = draft()?.path
      setFiles(loaded)
      const next = loaded.find((file) => file.path === currentPath) ?? loaded[0]
      setDraft(next ? { ...clone(next), isNew: false } : undefined)
      setSelectedScenario(0)
      resetDetail()
      setConflict(false)
      setStatus(
        `${loaded.length} specification${loaded.length === 1 ? '' : 's'}`,
      )
    } catch (cause) {
      setStatus(errorMessage(cause))
    }
  }

  async function refreshFiles() {
    try {
      const loaded = await request<SpecFile[]>('/api/specs')
      setFiles(loaded)
      setStatus(
        `${loaded.length} specification${loaded.length === 1 ? '' : 's'}`,
      )
    } catch (cause) {
      setStatus(errorMessage(cause))
    }
  }

  function selectFile(file: SpecFile) {
    if (dirty() && !window.confirm('Discard unsaved edits?')) return
    setDraft({ ...clone(file), isNew: false })
    setSelectedScenario(0)
    setConflict(false)
    resetDetail()
  }

  function updateDocument(update: (document: EditableSpecification) => void) {
    const current = draft()
    if (!current || current.readOnly) return
    const next = clone(current)
    update(next.document)
    setDraft(next)
  }

  function updateScenario(update: (item: EditableScenario) => void) {
    updateDocument((document) => {
      const item = document.scenarios[selectedScenario()]
      if (item) update(item)
    })
  }

  function chooseScenario(index: number) {
    setSelectedScenario(index)
    resetDetail()
  }

  function resetDetail() {
    setJsonErrors({})
    setDetailEpoch((value) => value + 1)
  }

  function addScenario() {
    const current = draft()
    if (!current) return
    updateDocument((document) =>
      document.scenarios.push(defaultScenario(document.kind)),
    )
    setSelectedScenario(current.document.scenarios.length)
    resetDetail()
  }

  function removeScenario(index: number) {
    const current = draft()
    if (!current || current.document.scenarios.length === 1) return
    updateDocument((document) => document.scenarios.splice(index, 1))
    setSelectedScenario(
      Math.max(0, Math.min(index, current.document.scenarios.length - 2)),
    )
    resetDetail()
  }

  function moveScenario(index: number, offset: number) {
    updateDocument((document) => move(document.scenarios, index, offset))
    setSelectedScenario(index + offset)
    resetDetail()
  }

  function beginNew() {
    setAdding(true)
    setNewPath('')
    setNewName('')
  }

  function createDraft() {
    const pathInput = newPath()
      .trim()
      .replace(/^src\/features\//, '')
    const path = pathInput.endsWith('/spec.json')
      ? pathInput
      : `${pathInput.replace(/\/$/, '')}/spec.json`
    const name = newName().trim()
    if (!pathInput || !/^[a-z][A-Za-z0-9]*$/.test(name)) {
      setStatus('Enter a relative path and a lower-camel Slice name.')
      return
    }
    const document = {
      $schema: 'https://specter.dev/specification/v1/slice.schema.json',
      formatVersion: 1,
      kind: newKind(),
      name,
      description: 'Describe this Slice.',
      scenarios: [defaultScenario(newKind())],
    } as EditableSpecification
    setDraft({
      path,
      revision: '',
      digest: 'sha256:',
      readOnly: false,
      document,
      isNew: true,
    })
    setAdding(false)
    setSelectedScenario(0)
    setConflict(false)
    resetDetail()
  }

  async function save() {
    const current = draft()
    if (
      !current ||
      current.readOnly ||
      conflict() ||
      Object.keys(jsonErrors()).length
    )
      return
    try {
      const saved = await request<SpecFile>('/api/specs', {
        method: current.isNew ? 'POST' : 'PUT',
        body: JSON.stringify({
          path: current.path,
          ...(current.isNew ? {} : { expectedRevision: current.revision }),
          document: current.document,
        }),
      })
      const loaded = await request<SpecFile[]>('/api/specs')
      setFiles(loaded)
      setDraft({ ...clone(saved), isNew: false })
      setConflict(false)
      setStatus(`Saved ${saved.path}`)
      resetDetail()
    } catch (cause) {
      setStatus(errorMessage(cause))
      if (errorCode(cause) === 'REVISION_CONFLICT') setConflict(true)
    }
  }

  async function removeCurrent() {
    const current = draft()
    if (!current || current.isNew || current.readOnly) return
    if (!window.confirm(`Delete only src/features/${current.path}?`)) return
    try {
      await request('/api/specs', {
        method: 'DELETE',
        body: JSON.stringify({
          path: current.path,
          expectedRevision: current.revision,
        }),
      })
      setDraft(undefined)
      await loadFiles()
    } catch (cause) {
      setStatus(errorMessage(cause))
      if (errorCode(cause) === 'REVISION_CONFLICT') setConflict(true)
    }
  }

  function jsonValidity(key: string, error: string) {
    setJsonErrors((current) => {
      const next = { ...current }
      if (error) next[key] = error
      else delete next[key]
      return next
    })
  }

  return (
    <main class="editor-shell">
      <aside class="slice-column">
        <header class="brand">
          <span class="mark">S</span>
          <span>
            <strong>Spec Editor</strong>
            <small>{status()}</small>
          </span>
        </header>
        <div class="slice-actions">
          <input
            aria-label="Search Slices"
            placeholder="Search Slices…"
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
          />
          <button class="primary" onClick={beginNew}>
            Add Slice
          </button>
        </div>
        <Show when={adding()}>
          <section class="new-slice-card">
            <label>
              Path below src/features
              <input
                placeholder="worklog/archive-task"
                value={newPath()}
                onInput={(event) => setNewPath(event.currentTarget.value)}
              />
            </label>
            <label>
              Slice name
              <input
                placeholder="archiveTask"
                value={newName()}
                onInput={(event) => setNewName(event.currentTarget.value)}
              />
            </label>
            <label>
              Kind
              <select
                value={newKind()}
                onChange={(event) =>
                  setNewKind(
                    event.currentTarget.value as
                      | 'command'
                      | 'query'
                      | 'reaction',
                  )
                }
              >
                <option value="command">Command</option>
                <option value="query">Query</option>
                <option value="reaction">Reaction</option>
              </select>
            </label>
            <div class="button-row">
              <button onClick={() => setAdding(false)}>Cancel</button>
              <button class="primary" onClick={createDraft}>
                Create draft
              </button>
            </div>
          </section>
        </Show>
        <nav class="slice-list">
          <For each={visibleFiles()}>
            {(file) => (
              <button
                classList={{ selected: draft()?.path === file.path }}
                onClick={() => selectFile(file)}
              >
                <span>
                  <strong>{file.document.name}</strong>
                  <small>{file.path}</small>
                </span>
                <span class={`kind ${file.document.kind}`}>
                  {file.document.kind}
                </span>
                <Show when={file.readOnly}>
                  <span class="lock">read only</span>
                </Show>
              </button>
            )}
          </For>
        </nav>
      </aside>

      <Show
        when={draft()}
        fallback={
          <section class="empty-state">
            Add or select a Slice specification.
          </section>
        }
        keyed
      >
        {(current) => (
          <>
            <section class="scenario-column">
              <header class="slice-heading">
                <span class={`kind ${current.document.kind}`}>
                  {current.document.kind}
                </span>
                <label>
                  Name
                  <input
                    value={current.document.name}
                    disabled={current.readOnly}
                    onInput={(event) =>
                      updateDocument((document) => {
                        document.name = event.currentTarget.value
                      })
                    }
                  />
                </label>
                <label>
                  Description
                  <textarea
                    rows={3}
                    disabled={current.readOnly}
                    value={current.document.description}
                    onInput={(event) =>
                      updateDocument((document) => {
                        document.description = event.currentTarget.value
                      })
                    }
                  />
                </label>
                <small class="path">src/features/{current.path}</small>
                <small class="digest">
                  {current.isNew ? 'Digest calculated on Save' : current.digest}
                </small>
                <Show when={current.readOnly}>
                  <p class="warning">
                    Adjacent spec.ts owns this generated file.
                  </p>
                </Show>
                <Show when={conflict()}>
                  <p class="error">Disk changed. Reload before saving.</p>
                </Show>
                <div class="button-row">
                  <button onClick={() => void loadFiles()}>Reload</button>
                  <button
                    disabled={current.isNew || current.readOnly}
                    class="danger"
                    onClick={() => void removeCurrent()}
                  >
                    Remove
                  </button>
                  <button
                    class="primary"
                    disabled={
                      !dirty() ||
                      current.readOnly ||
                      conflict() ||
                      Object.keys(jsonErrors()).length > 0
                    }
                    onClick={() => void save()}
                  >
                    Save
                  </button>
                </div>
              </header>
              <div class="section-title">
                <strong>Scenarios</strong>
                <button disabled={current.readOnly} onClick={addScenario}>
                  Add
                </button>
              </div>
              <div class="scenario-list">
                <For each={current.document.scenarios}>
                  {(item, index) => (
                    <article
                      classList={{ selected: selectedScenario() === index() }}
                    >
                      <button
                        class="scenario-select"
                        onClick={() => chooseScenario(index())}
                      >
                        <span>{index() + 1}</span>
                        <strong>{item.description}</strong>
                      </button>
                      <div class="order-buttons">
                        <button
                          aria-label="Move scenario up"
                          disabled={current.readOnly || index() === 0}
                          onClick={() => moveScenario(index(), -1)}
                        >
                          ↑
                        </button>
                        <button
                          aria-label="Move scenario down"
                          disabled={
                            current.readOnly ||
                            index() === current.document.scenarios.length - 1
                          }
                          onClick={() => moveScenario(index(), 1)}
                        >
                          ↓
                        </button>
                        <button
                          aria-label="Remove scenario"
                          disabled={
                            current.readOnly ||
                            current.document.scenarios.length === 1
                          }
                          onClick={() => removeScenario(index())}
                        >
                          ×
                        </button>
                      </div>
                    </article>
                  )}
                </For>
              </div>
            </section>

            <section class="detail-column">
              <Show
                keyed
                when={`${current.path}:${selectedScenario()}:${detailEpoch()}`}
              >
                <Show when={scenario()} keyed>
                  {(item) => (
                    <ScenarioEditor
                      kind={current.document.kind}
                      scenario={item}
                      readOnly={current.readOnly}
                      eventNames={eventNames()}
                      update={updateScenario}
                      resetDetail={resetDetail}
                      jsonValidity={jsonValidity}
                    />
                  )}
                </Show>
              </Show>
            </section>
          </>
        )}
      </Show>
      <datalist id="event-name-suggestions">
        <For each={eventNames()}>{(name) => <option value={name} />}</For>
      </datalist>
    </main>
  )
}

function ScenarioEditor(props: {
  kind: 'command' | 'query' | 'reaction'
  scenario: EditableScenario
  readOnly: boolean
  eventNames: string[]
  update(update: (scenario: EditableScenario) => void): void
  resetDetail(): void
  jsonValidity(key: string, error: string): void
}) {
  const rejected = () =>
    props.kind === 'command' && Boolean(props.scenario.reject)
  return (
    <div class="detail-stack">
      <header>
        <span class="eyebrow">Scenario</span>
        <h1>{props.scenario.description}</h1>
      </header>
      <label>
        Description
        <input
          disabled={props.readOnly}
          value={props.scenario.description}
          onInput={(event) =>
            props.update((item) => {
              item.description = event.currentTarget.value
            })
          }
        />
      </label>
      <EventList
        title="Given Events"
        events={props.scenario.given}
        readOnly={props.readOnly}
        onChange={(events) =>
          props.update((item) => {
            item.given = events
          })
        }
        resetDetail={props.resetDetail}
        jsonValidity={props.jsonValidity}
        prefix="given"
      />
      <Show when={props.kind !== 'reaction'}>
        <JsonField
          title={props.kind === 'query' ? 'Query input' : 'Command input'}
          value={props.scenario.when ?? {}}
          readOnly={props.readOnly}
          errorKey="when"
          onValue={(value) =>
            props.update((item) => {
              item.when = value
            })
          }
          jsonValidity={props.jsonValidity}
        />
      </Show>
      <Show when={props.kind === 'command'}>
        <section class="stage-card">
          <div class="stage-title">
            <strong>Outcome</strong>
            <select
              disabled={props.readOnly}
              value={rejected() ? 'rejected' : 'accepted'}
              onChange={(event) => {
                props.update((item) => {
                  if (event.currentTarget.value === 'rejected') {
                    item.expect = []
                    item.reject = { reason: 'Describe the rejection.' }
                  } else {
                    delete item.reject
                    item.expect = [defaultEvent()]
                  }
                })
                props.resetDetail()
              }}
            >
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <Show
            when={rejected()}
            fallback={
              <EventList
                title="Expected Events"
                events={eventArray(props.scenario.expect)}
                readOnly={props.readOnly}
                onChange={(events) =>
                  props.update((item) => {
                    item.expect = events
                  })
                }
                resetDetail={props.resetDetail}
                jsonValidity={props.jsonValidity}
                prefix="expect"
              />
            }
          >
            <label>
              Exact rejection reason
              <textarea
                rows={3}
                disabled={props.readOnly}
                value={props.scenario.reject?.reason ?? ''}
                onInput={(event) =>
                  props.update((item) => {
                    item.reject = { reason: event.currentTarget.value }
                  })
                }
              />
            </label>
          </Show>
        </section>
      </Show>
      <Show when={props.kind === 'query'}>
        <JsonField
          title="Expected result"
          value={props.scenario.expect as JsonValue}
          readOnly={props.readOnly}
          errorKey="query-expect"
          onValue={(value) =>
            props.update((item) => {
              item.expect = value
            })
          }
          jsonValidity={props.jsonValidity}
        />
      </Show>
      <Show when={props.kind === 'reaction'}>
        <PayloadList
          values={props.scenario.expect as JsonValue[]}
          readOnly={props.readOnly}
          onChange={(values) =>
            props.update((item) => {
              item.expect = values
            })
          }
          resetDetail={props.resetDetail}
          jsonValidity={props.jsonValidity}
        />
      </Show>
    </div>
  )
}

function EventList(props: {
  title: string
  events: EditableEvent[]
  readOnly: boolean
  onChange(events: EditableEvent[]): void
  resetDetail(): void
  jsonValidity(key: string, error: string): void
  prefix: string
}) {
  function update(index: number, change: (event: EditableEvent) => void) {
    const events = clone(props.events)
    const event = events[index]
    if (event) change(event)
    props.onChange(events)
  }
  return (
    <section class="stage-card">
      <div class="stage-title">
        <strong>{props.title}</strong>
        <button
          disabled={props.readOnly}
          onClick={() => {
            props.onChange([...props.events, defaultEvent()])
            props.resetDetail()
          }}
        >
          Add Event
        </button>
      </div>
      <Show
        when={props.events.length}
        fallback={<p class="muted">No Events.</p>}
      >
        <For each={props.events}>
          {(event, index) => (
            <article class="event-card">
              <div class="event-heading">
                <label>
                  Event name
                  <input
                    list="event-name-suggestions"
                    disabled={props.readOnly}
                    value={event.eventType}
                    onInput={(input) =>
                      update(index(), (item) => {
                        item.eventType = input.currentTarget.value
                      })
                    }
                  />
                </label>
                <div class="order-buttons">
                  <button
                    disabled={props.readOnly || index() === 0}
                    onClick={() => {
                      const events = clone(props.events)
                      move(events, index(), -1)
                      props.onChange(events)
                      props.resetDetail()
                    }}
                  >
                    ↑
                  </button>
                  <button
                    disabled={
                      props.readOnly || index() === props.events.length - 1
                    }
                    onClick={() => {
                      const events = clone(props.events)
                      move(events, index(), 1)
                      props.onChange(events)
                      props.resetDetail()
                    }}
                  >
                    ↓
                  </button>
                  <button
                    disabled={props.readOnly}
                    onClick={() => {
                      props.onChange(
                        props.events.filter(
                          (_, itemIndex) => itemIndex !== index(),
                        ),
                      )
                      props.resetDetail()
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
              <JsonField
                title="Example payload"
                value={event.examplePayload}
                readOnly={props.readOnly}
                errorKey={`${props.prefix}-${index()}`}
                onValue={(value) =>
                  update(index(), (item) => {
                    item.examplePayload = value
                  })
                }
                jsonValidity={props.jsonValidity}
              />
            </article>
          )}
        </For>
      </Show>
    </section>
  )
}

function PayloadList(props: {
  values: JsonValue[]
  readOnly: boolean
  onChange(values: JsonValue[]): void
  resetDetail(): void
  jsonValidity(key: string, error: string): void
}) {
  return (
    <section class="stage-card">
      <div class="stage-title">
        <strong>Expected outputs</strong>
        <button
          disabled={props.readOnly}
          onClick={() => {
            props.onChange([...props.values, {}])
            props.resetDetail()
          }}
        >
          Add output
        </button>
      </div>
      <For each={props.values}>
        {(value, index) => (
          <article class="event-card">
            <div class="event-heading">
              <strong>Output {index() + 1}</strong>
              <div class="order-buttons">
                <button
                  disabled={props.readOnly || index() === 0}
                  onClick={() => {
                    const values = clone(props.values)
                    move(values, index(), -1)
                    props.onChange(values)
                    props.resetDetail()
                  }}
                >
                  ↑
                </button>
                <button
                  disabled={
                    props.readOnly || index() === props.values.length - 1
                  }
                  onClick={() => {
                    const values = clone(props.values)
                    move(values, index(), 1)
                    props.onChange(values)
                    props.resetDetail()
                  }}
                >
                  ↓
                </button>
                <button
                  disabled={props.readOnly}
                  onClick={() => {
                    props.onChange(
                      props.values.filter(
                        (_, itemIndex) => itemIndex !== index(),
                      ),
                    )
                    props.resetDetail()
                  }}
                >
                  ×
                </button>
              </div>
            </div>
            <JsonField
              title="JSON value"
              value={value}
              readOnly={props.readOnly}
              errorKey={`reaction-expect-${index()}`}
              onValue={(next) => {
                const values = clone(props.values)
                values[index()] = next
                props.onChange(values)
              }}
              jsonValidity={props.jsonValidity}
            />
          </article>
        )}
      </For>
    </section>
  )
}

function JsonField(props: {
  title: string
  value: JsonValue
  readOnly: boolean
  errorKey: string
  onValue(value: JsonValue): void
  jsonValidity(key: string, error: string): void
}) {
  let host!: HTMLDivElement
  const [error, setError] = createSignal('')
  onMount(() => {
    const view = new EditorView({
      parent: host,
      doc: JSON.stringify(props.value, null, 2),
      extensions: [
        basicSetup,
        jsonLanguage(),
        EditorView.lineWrapping,
        EditorView.editable.of(!props.readOnly),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          try {
            const value = JSON.parse(update.state.doc.toString()) as JsonValue
            setError('')
            props.jsonValidity(props.errorKey, '')
            props.onValue(value)
          } catch (cause) {
            const message = errorMessage(cause)
            setError(message)
            props.jsonValidity(props.errorKey, message)
          }
        }),
      ],
    })
    onCleanup(() => view.destroy())
  })
  return (
    <div class="json-field">
      <span>{props.title}</span>
      <div class="code-editor" ref={host} />
      <Show when={error()}>
        <small class="error">{error()}</small>
      </Show>
    </div>
  )
}

function defaultScenario(
  kind: 'command' | 'query' | 'reaction',
): EditableScenario {
  if (kind === 'reaction')
    return { description: 'Describe this scenario.', given: [], expect: [] }
  if (kind === 'query')
    return {
      description: 'Describe this scenario.',
      given: [],
      when: {},
      expect: {},
    }
  return {
    description: 'Describe this scenario.',
    given: [],
    when: {},
    expect: [],
    reject: { reason: 'Describe the rejection.' },
  }
}

function defaultEvent(): EditableEvent {
  return { kind: 'scenario-event', eventType: 'event-name', examplePayload: {} }
}

function eventArray(value: JsonValue | EditableEvent[]) {
  return Array.isArray(value) && value.every(isScenarioEvent) ? value : []
}

function isScenarioEvent(value: unknown): value is EditableEvent {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'kind' in value &&
      value.kind === 'scenario-event',
  )
}

function move<T>(values: T[], index: number, offset: number) {
  const target = index + offset
  if (target < 0 || target >= values.length) return
  const [value] = values.splice(index, 1)
  if (value !== undefined) values.splice(target, 0, value)
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

async function request<T = void>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string
      code?: string
    }
    const error = new Error(
      body.error ?? `Request failed with HTTP ${response.status}.`,
    )
    Object.assign(error, { code: body.code })
    throw error
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>)
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}

function errorCode(cause: unknown) {
  return cause instanceof Error && 'code' in cause
    ? String(cause.code)
    : undefined
}
