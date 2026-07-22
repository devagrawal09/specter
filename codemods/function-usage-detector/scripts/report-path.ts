import { isAbsolute, relative, resolve, sep } from 'path'

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
