import { createContext, createSignal, useContext } from 'solid-js'
import type { ProviderProps } from './shared/view-helpers'

function createSelectionModel() {
  const [activeWorkspaceId, setActiveWorkspaceId] = createSignal<string | null>(null)
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(null)
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null)
  const [selectedFilePath, setSelectedFilePath] = createSignal<string | null>(null)
  const [activeRunId, setActiveRunId] = createSignal<string | null>(null)

  function selectWorkspace(workspaceId: string | null) {
    setActiveWorkspaceId(workspaceId)
    setSelectedPath(null)
    setSelectedFilePath(null)
    setActiveRunId(null)
    setActiveSessionId(null)
  }

  return {
    activeWorkspaceId,
    setActiveWorkspaceId,
    activeSessionId,
    setActiveSessionId,
    selectedPath,
    setSelectedPath,
    selectedFilePath,
    setSelectedFilePath,
    activeRunId,
    setActiveRunId,
    selectWorkspace,
  }
}

type SelectionContextValue = ReturnType<typeof createSelectionModel>

const SelectionContext = createContext<SelectionContextValue>()

export function SpecterCodeSelectionProvider(props: ProviderProps) {
  const value = createSelectionModel()
  return (
    <SelectionContext.Provider value={value}>
      {props.children}
    </SelectionContext.Provider>
  )
}

export function useSpecterCodeSelection() {
  const value = useContext(SelectionContext)
  if (!value) throw new Error('useSpecterCodeSelection must be used inside SpecterCodeSelectionProvider')
  return value
}
