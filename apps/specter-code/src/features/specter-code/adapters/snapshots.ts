import { readFile } from 'node:fs/promises'

export type FileSnapshot = {
  path: string
  existed: boolean
  content?: string
}

export async function createFileSnapshot(input: {
  path: string
  absolutePath: string
  existed: boolean
}): Promise<FileSnapshot> {
  if (!input.existed) return { path: input.path, existed: false }

  return {
    path: input.path,
    existed: true,
    content: await readFile(input.absolutePath, 'utf8'),
  }
}
