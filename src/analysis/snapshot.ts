import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { identify, referencesIn } from './parse.js'
import { componentKey, type AnalyzeOptions, type Component, type Snapshot } from './types.js'

const exec = promisify(execFile)
const SKIP = new Set(['.git', 'node_modules', '.sf', '.sfdx', 'dist'])

type RawChange = {
  status: 'added' | 'modified' | 'deleted'
  path: string
  contents: string
}

export async function resolveSnapshot(options: AnalyzeOptions): Promise<Snapshot> {
  if (options.sourceDir || options.targetDir) {
    if (!options.sourceDir || !options.targetDir) {
      throw new Error('Pass both --source-dir and --target-dir, or neither.')
    }
    return directorySnapshot(options.sourceDir, options.targetDir)
  }
  if (!options.source || !options.target) {
    throw new Error('Pass --source and --target, or --source-dir and --target-dir.')
  }
  const sourceIsRef = await gitRefExists(options.repo, options.source)
  const targetIsRef = await gitRefExists(options.repo, options.target)
  if (sourceIsRef && targetIsRef) return gitSnapshot(options.repo, options.source, options.target)
  const sourceDir = path.resolve(options.repo, options.source)
  const targetDir = path.resolve(options.repo, options.target)
  if (await isDirectory(sourceDir) && await isDirectory(targetDir)) return directorySnapshot(sourceDir, targetDir)
  throw new Error(
    `Could not resolve source "${options.source}" and target "${options.target}" as git refs or metadata directories.`,
  )
}

async function directorySnapshot(sourceDir: string, targetDir: string): Promise<Snapshot> {
  const sourceFiles = await readTree(sourceDir)
  const targetFiles = await readTree(targetDir)
  const changes: RawChange[] = []
  for (const [filePath, contents] of sourceFiles) {
    if (!targetFiles.has(filePath)) changes.push({ status: 'added', path: filePath, contents })
    else if (targetFiles.get(filePath) !== contents) changes.push({ status: 'modified', path: filePath, contents })
  }
  return finishSnapshot('directory', sourceDir, targetDir, changes, sourceFiles, targetFiles)
}

async function gitSnapshot(repo: string, source: string, target: string): Promise<Snapshot> {
  assertRef(source)
  assertRef(target)
  const diff = await git(repo, ['diff', '--name-status', '--find-renames', `${target}...${source}`])
  const changes: RawChange[] = []
  for (const line of diff.split(/\r?\n/).filter(Boolean)) {
    const [status, first, second] = line.split('\t')
    if (status.startsWith('R') || status.startsWith('C')) {
      changes.push({ status: 'deleted', path: first, contents: await gitShow(repo, target, first) })
      changes.push({ status: 'added', path: second, contents: await gitShow(repo, source, second) })
    } else if (status === 'A') {
      changes.push({ status: 'added', path: first, contents: await gitShow(repo, source, first) })
    } else if (status === 'M') {
      changes.push({ status: 'modified', path: first, contents: await gitShow(repo, source, first) })
    } else if (status === 'D') {
      changes.push({ status: 'deleted', path: first, contents: await gitShow(repo, target, first) })
    }
  }
  const sourceFiles = await gitMetadata(repo, source)
  const targetFiles = await gitMetadata(repo, target)
  return finishSnapshot('git', source, target, changes, sourceFiles, targetFiles)
}

function finishSnapshot(
  mode: Snapshot['mode'],
  source: string,
  target: string,
  changes: RawChange[],
  sourceFiles: Map<string, string>,
  targetFiles: Map<string, string>,
): Snapshot {
  return {
    mode,
    source,
    target,
    changes: groupComponents(changes),
    sourceComponents: toMap(groupComponents([...sourceFiles].map(([filePath, contents]) => ({ status: 'modified' as const, path: filePath, contents })))),
    targetComponents: toMap(groupComponents([...targetFiles].map(([filePath, contents]) => ({ status: 'modified' as const, path: filePath, contents })))),
  }
}

function toMap(components: Component[]): Map<string, Component> {
  return new Map(components.map((component) => [componentKey(component.type, component.fullName), component]))
}

function groupComponents(files: RawChange[]): Component[] {
  const grouped = new Map<string, Component>()
  for (const file of files) {
    const identified = identify(file.path)
    if (!identified) continue
    const key = componentKey(identified.type, identified.fullName)
    const existing = grouped.get(key)
    const references = referencesIn(file.path, file.contents)
    if (!existing) {
      grouped.set(key, {
        type: identified.type,
        fullName: identified.fullName,
        status: file.status,
        paths: [file.path],
        contents: file.contents,
        references,
      })
      continue
    }
    existing.paths.push(file.path)
    existing.contents += `\n${file.contents}`
    existing.references.push(...references)
    if (existing.status !== file.status) existing.status = 'modified'
  }
  return [...grouped.values()]
}

async function readTree(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
      } else if (entry.isFile()) {
        const relative = path.relative(root, absolute).replaceAll('\\', '/')
        if (!identify(relative) && !relative.endsWith('.cls') && !relative.endsWith('.trigger') && !relative.endsWith('.js')) continue
        files.set(relative, await readFile(absolute, 'utf8'))
      }
    }
  }
  await walk(root)
  return files
}

async function gitMetadata(repo: string, ref: string): Promise<Map<string, string>> {
  const listed = await git(repo, ['ls-tree', '-r', '--name-only', ref])
  const files = new Map<string, string>()
  for (const filePath of listed.split(/\r?\n/).filter((value) => value && identify(value))) {
    files.set(filePath, await gitShow(repo, ref, filePath))
  }
  return files
}

async function gitShow(repo: string, ref: string, filePath: string): Promise<string> {
  try {
    return await git(repo, ['show', `${ref}:${filePath}`])
  } catch {
    return ''
  }
}

async function gitRefExists(repo: string, ref: string): Promise<boolean> {
  if (!isSafeRef(ref)) return false
  try {
    await git(repo, ['rev-parse', '--verify', '--quiet', ref])
    return true
  } catch {
    return false
  }
}

function assertRef(ref: string): void {
  if (!isSafeRef(ref)) throw new Error(`Ref "${ref}" contains characters that are not allowed.`)
}

function isSafeRef(ref: string): boolean {
  return /^[\w./-]+$/.test(ref) && !ref.includes('..') && !ref.startsWith('-')
}

async function git(repo: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('git', ['-C', repo, ...args], { maxBuffer: 20_000_000, windowsHide: true })
    return stdout
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr || (error as Error).message
    throw new Error(`git ${args.join(' ')} failed. ${stderr}`.trim())
  }
}

async function isDirectory(value: string): Promise<boolean> {
  try {
    return (await stat(value)).isDirectory()
  } catch {
    return false
  }
}

export async function commandOutput(bin: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec(bin, args, { maxBuffer: 20_000_000, windowsHide: true })
    return stdout
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' && bin === 'sf') return commandOutput('sf.cmd', args)
    throw error
  }
}

