import {
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { basename, isAbsolute, relative, resolve, sep } from 'path'

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
  mkdirSync(output, { recursive: true })
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
    unlinkSync(destination)
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
  writeFileSync(destination, contents, { flag: 'wx' })
}

function assertNoSymlinkComponents(target: string, output: string) {
  const segments = relative(target, output).split(sep).filter(Boolean)
  let current = target

  for (const segment of segments) {
    if (!existsSync(current)) return

    const entry = readdirSync(current, { withFileTypes: true }).find(
      (candidate) => candidate.name === segment,
    )
    if (!entry) return
    if (entry.isSymbolicLink()) {
      throw new Error('report_directory must not traverse a symbolic link')
    }
    current = resolve(current, segment)
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
