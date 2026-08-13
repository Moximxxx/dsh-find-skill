/**
 * Managed skill roots: project / global / temp directories owned by this plugin.
 *
 * @module dsh-find-skill/roots
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { Config } from './config.ts'

/** Resolved managed roots for one workspace lookup. */
export interface ManagedRoots {
  /** Nearest ancestor containing .git, or the cwd when none exists. */
  readonly projectRoot: string
  /** Project-scoped managed skill directory. */
  readonly projectSkillDir: string
  /** User-global managed skill directory. */
  readonly globalSkillDir: string
  /** Temporary materialization directory. */
  readonly tempSkillDir: string
}

/**
 * Resolve the managed skill roots for a workspace.
 * @param config - validated plugin configuration.
 * @param cwd - workspace selector; project roots resolve from it.
 * @returns absolute managed root paths.
 */
export function resolveRoots(config: Config, cwd?: string): ManagedRoots {
  const dshHome = resolveDshHome()
  const projectRoot = cwd === undefined ? process.cwd() : findProjectRoot(resolve(cwd))
  const projectSkillDir = join(projectRoot, config.projectSkillRoot ?? '.dsh/skills-bridge')
  const globalSkillDir = config.globalSkillRoot
    ? resolve(config.globalSkillRoot)
    : join(dshHome, 'skills-bridge', 'global')
  const tempSkillDir = config.tempSkillRoot
    ? resolve(config.tempSkillRoot)
    : join(dshHome, 'skills-bridge', 'tmp')
  return { projectRoot, projectSkillDir, globalSkillDir, tempSkillDir }
}

/**
 * Walk upward from a directory to the nearest ancestor containing .git.
 * @param cwd - starting directory.
 * @returns the nearest git root, or the original directory when none exists.
 */
export function findProjectRoot(cwd: string): string {
  let current = resolve(cwd)
  for (;;) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return cwd
    current = parent
  }
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}
