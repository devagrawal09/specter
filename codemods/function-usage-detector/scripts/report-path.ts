import * as fs from 'fs'
import { basename, isAbsolute, relative, resolve, sep } from 'path'

const runtimeFs = fs as typeof fs & {
  unlinkSync(path: string): void
}

export function reportDirectory(targetDirectory: string, configuredPath: string) {
  const trimmedPath = configuredPath.trim()
  if (!trimmedPath) {
    throw new Error('report_directory must not be empty')
  }
  if (isAbsolute(trimmedPath)) {
    throw new Error('report_directory must be relative to the target directory')
  }

  const target = resolve(targetDirectory)
  const output = resolve(target, trimmedPath)
  const relativePath = relative(target, output)
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error('report_directory must stay inside the target directory')
  }

  return output
}

export function prepareReportDirectory(
  targetDirectory: string,
  configuredPath: string,
) {
  const target = resolve(targetDirectory)
  const output = reportDirectory(targetDirectory, configuredPath)

  assertNoSymlinkComponents(target, output)
  fs.mkdirSync(output, { recursive: true })
  assertNoSymlinkComponents(target, output)
  return output
}

export function writeReportArtifact(
  outputDirectory: string,
  filename: string,
  contents: string,
) {
  if (
    !filename ||
    filename === '.' ||
    filename === '..' ||
    basename(filename) !== filename
  ) {
    throw new Error('report filename must not contain a path')
  }

  const destination = resolve(outputDirectory, filename)
  try {
    runtimeFs.unlinkSync(destination)
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
  fs.writeFileSync(destination, contents)
}

function assertNoSymlinkComponents(target: string, output: string) {
  const segments = relative(target, output).split(sep).filter(Boolean)
  let current = target

  for (const segment of segments) {
    if (!pathExists(current)) return

    const entry = fs.readdirSync(current, { withFileTypes: true }).find(
      (candidate) => candidate.name === segment,
    )
    if (!entry) return
    if (entry.isSymbolicLink()) {
      throw new Error('report_directory must not traverse a symbolic link')
    }
    current = resolve(current, segment)
  }
}

function pathExists(path: string) {
  try {
    fs.accessSync(path)
    return true
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false
    }
    throw error
  }
}

function isMissingFile(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
