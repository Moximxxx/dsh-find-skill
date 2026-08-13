/**
 * Official skills CLI integration: source resolution, fetching, and adoption
 * of installed skills into plugin-managed roots.
 *
 * The CLI always installs into its own agent directories, so every fetch runs
 * inside a throwaway work/home pair and only the requested skill directory is
 * adopted; all other artifacts are discarded with the throwaway directory.
 *
 * @module dsh-find-skill/cli
 */

import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSkillContent } from './frontmatter.ts'

/** Outcome of one spawned CLI command. */
export interface CliResult {
  /** Captured stdout. */
  readonly stdout: string
  /** Captured stderr. */
  readonly stderr: string
}

/**
 * Run one command line with arguments and capture its output.
 * @param commandLine - executable plus fixed leading tokens (e.g. npx -y skills@latest).
 * @param args - additional arguments appended after the fixed tokens.
 * @param options - cwd, environment, and abort signal for the child process.
 * @returns captured stdout and stderr; rejects on a non-zero exit.
 */
export function runCli(
  commandLine: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {},
): Promise<CliResult> {
  const tokens = commandLine.trim().split(/\s+/)
  if (tokens.length === 0) throw new Error('cliCommand is empty')
  const [command, ...fixed] = tokens
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...fixed, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += String(chunk) })
    const abort = () => { child.kill('SIGTERM') }
    options.signal?.addEventListener('abort', abort, { once: true })
    child.on('error', (error) => {
      options.signal?.removeEventListener('abort', abort)
      reject(error)
    })
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', abort)
      if (code === 0) {
        resolvePromise({ stdout, stderr })
      } else {
        reject(new Error(`${commandLine} exited with code ${code}: ${stderr.trim().slice(-800)}`))
      }
    })
  })
}

/** A skill fetched into a throwaway directory, ready for adoption. */
export interface FetchedSkill {
  /** Directory containing the SKILL.md bundle. */
  readonly skillDir: string
  /** Directory holding all throwaway fetch artifacts. */
  readonly scratchRoot: string
}

function throwawayEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CACHE_HOME: join(home, '.cache'),
    // Keep the npm cache in the real home so npx does not re-download per fetch.
    npm_config_cache: process.env.npm_config_cache ?? join(homedir(), '.npm'),
  }
}

/**
 * Fetch one skill through the official CLI into a throwaway work directory.
 * @param cliCommand - configured CLI command line.
 * @param source - skill source (owner/repo, URL, or owner/repo@skill).
 * @param skillName - exact skill name filter; optional when the source selects one skill.
 * @param workBase - base directory for throwaway scratch space.
 * @param signal - cancellation signal.
 * @returns the adopted skill directory plus its scratch root.
 */
export async function fetchSkillViaCli(
  cliCommand: string,
  source: string,
  skillName: string | undefined,
  workBase: string,
  signal?: AbortSignal,
): Promise<FetchedSkill> {
  await mkdir(workBase, { recursive: true })
  const scratchRoot = await mkdtemp(join(workBase, 'fetch-'))
  const work = join(scratchRoot, 'work')
  const home = join(scratchRoot, 'home')
  await mkdir(work, { recursive: true })
  await mkdir(home, { recursive: true })
  const args = ['add', source, '-y']
  if (skillName !== undefined && skillName.length > 0) {
    args.push('--skill', skillName)
  }
  await runCli(cliCommand, args, { cwd: work, env: throwawayEnv(home), signal })
  const installedRoot = join(work, '.agents', 'skills')
  const skillDir = await locateInstalledSkill(installedRoot, skillName)
  return { skillDir, scratchRoot }
}

/**
 * Locate the installed skill directory inside a CLI install root.
 * @param installedRoot - the .agents/skills directory written by the CLI.
 * @param skillName - expected frontmatter name; optional for single-skill installs.
 * @returns the absolute skill directory path.
 */
export async function locateInstalledSkill(installedRoot: string, skillName?: string): Promise<string> {
  const entries = await readdir(installedRoot, { withFileTypes: true }).catch(() => [])
  const dirs = entries.filter(entry => entry.isDirectory()).map(entry => join(installedRoot, entry.name))
  if (dirs.length === 0) throw new Error(`${installedRoot} contains no installed skill directories`)
  if (skillName !== undefined) {
    for (const dir of dirs) {
      try {
        const parsed = parseSkillContent(await readFile(join(dir, 'SKILL.md'), 'utf8'), dir)
        if (parsed.name === skillName) return dir
      } catch {
        // Invalid or unreadable skill directories are skipped while matching.
      }
    }
  }
  if (dirs.length === 1) return dirs[0]!
  throw new Error(`${installedRoot} contains multiple skill directories; pass an explicit skill name`)
}

/**
 * Remove a throwaway fetch scratch root.
 * @param fetched - the fetched skill whose scratch space should be discarded.
 * @returns a promise settling when cleanup finishes.
 */
export async function cleanupFetch(fetched: FetchedSkill): Promise<void> {
  await rm(fetched.scratchRoot, { recursive: true, force: true })
}

/** Resolve the default scratch base directory. */
export function defaultWorkBase(): string {
  return tmpdir()
}
