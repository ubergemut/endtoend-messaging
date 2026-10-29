import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { HeadlessError } from '@e2ee/protocol'

function errno(error: unknown) {
  return (error as NodeJS.ErrnoException).code
}

export async function readDurableFile(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (errno(error) !== 'ENOENT') throw new HeadlessError('Vault file could not be read', 'vault')
  }
  try {
    const recovered = await readFile(`${file}.bak`, 'utf8')
    await rename(`${file}.bak`, file).catch(() => undefined)
    return recovered
  } catch (error) {
    if (errno(error) === 'ENOENT') return null
    throw new HeadlessError('Vault file could not be read', 'vault')
  }
}

export async function writeDurableFile(file: string, contents: string, interrupt?: 'after-temp' | 'after-backup') {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  const backup = `${file}.bak`
  await writeFile(temp, contents)
  if (interrupt === 'after-temp') throw new Error('interrupted after temp')
  try {
    await rename(file, backup)
  } catch (error) {
    if (errno(error) !== 'ENOENT') throw new HeadlessError('Vault file could not be replaced', 'vault')
  }
  if (interrupt === 'after-backup') throw new Error('interrupted after backup')
  await rename(temp, file)
  await rm(backup, { force: true })
}
