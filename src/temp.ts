/**
 * Temporary skill lifecycle: runtime registrations plus their materialized
 * directories, disposed on demand or when the plugin unloads.
 *
 * @module dsh-find-skill/temp
 */

import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

/** One tracked temporary skill. */
export interface TempSkillEntry {
  /** Skill name registered with ctx.skills. */
  readonly name: string
  /** Absolute directory holding the materialized skill files. */
  readonly dir: string
  /** Owning session id when the skill was installed from a live session. */
  readonly owner?: string
}

/**
 * Tracks runtime skill registrations so callers can list, unregister, and
 * bulk-dispose temporary skills across sessions and compaction events.
 */
export class TempSkillManager {
  private readonly entries = new Map<string, { dir: string; disposer: () => void; owner?: string }>()

  /**
   * Create the manager over the registry's runtime registration function.
   * @param register - ctx.skills.register, used for every temporary skill.
   * @param baseDir - root under which materialized temp skill directories live.
   */
  private readonly register: (skill: SkillRegistration) => () => void
  private readonly baseDir: string

  constructor(register: (skill: SkillRegistration) => () => void, baseDir: string) {
    this.register = register
    this.baseDir = baseDir
  }

  /**
   * Register a materialized temporary skill and track it.
   * @param skill - the skill definition to register; provider defaults to runtime.
   * @param dir - absolute materialized directory (resource base for the skill).
   * @param owner - owning session id; skills owned by a session are disposed when it ends.
   * @returns the new tracked entry.
   */
  async add(skill: SkillRegistration, dir: string, owner?: string): Promise<TempSkillEntry> {
    await mkdir(dir, { recursive: true })
    if (this.entries.has(skill.name)) {
      this.disposeOne(skill.name)
    }
    const disposer = this.register({
      ...skill,
      source: 'custom',
      resourceBase: { kind: 'directory', path: dir },
    })
    this.entries.set(skill.name, { dir, disposer, ...owner !== undefined ? { owner } : {} })
    return { name: skill.name, dir, ...owner !== undefined ? { owner } : {} }
  }

  /**
   * Dispose every temporary skill owned by one session.
   * @param owner - the session id whose skills should be removed.
   * @returns whether any entry was disposed.
   */
  async disposeOwned(owner: string): Promise<boolean> {
    const names = [...this.entries.entries()]
      .filter(([, entry]) => entry.owner === owner)
      .map(([name]) => name)
    await Promise.all(names.map(name => this.disposeOne(name)))
    return names.length > 0
  }

  /**
   * Remove one temporary skill: unregister from the registry and delete its directory.
   * @param name - skill name to remove.
   * @returns whether a matching entry existed.
   */
  async remove(name: string): Promise<boolean> {
    return this.disposeOne(name)
  }

  /**
   * List tracked temporary skills.
   * @returns name-sorted entries.
   */
  list(): TempSkillEntry[] {
    return [...this.entries.entries()]
      .map(([name, entry]) => ({ name, dir: entry.dir, ...entry.owner !== undefined ? { owner: entry.owner } : {} }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Whether a temporary skill with this name is currently tracked.
   * @param name - skill name to look up.
   * @returns whether the entry exists.
   */
  has(name: string): boolean {
    return this.entries.has(name)
  }

  /**
   * Dispose every temporary skill.
   * @returns a promise settling when all directories are removed.
   */
  async disposeAll(): Promise<void> {
    const names = [...this.entries.keys()]
    await Promise.all(names.map(name => this.disposeOne(name)))
  }

  private async disposeOne(name: string): Promise<boolean> {
    const entry = this.entries.get(name)
    if (entry === undefined) return false
    this.entries.delete(name)
    try {
      entry.disposer()
    } finally {
      await rm(join(entry.dir), { recursive: true, force: true })
    }
    return true
  }
}

/** Resolve the temp skill base directory, creating it on demand. */
export async function ensureTempBase(baseDir: string): Promise<string> {
  await mkdir(baseDir, { recursive: true })
  return baseDir
}
