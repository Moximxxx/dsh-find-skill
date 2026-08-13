/**
 * Install / remove service: fetch skills through the official CLI and place
 * them into temp / project / global managed scopes.
 *
 * @module dsh-find-skill/install
 */

import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import { cleanupFetch, fetchSkillViaCli } from './cli.ts'
import type { Config, InstallScope } from './config.ts'
import { parseSkillContent } from './frontmatter.ts'
import { writeMetadata } from './metadata.ts'
import type { ManagedSkillProvider } from './provider.ts'
import type { TempSkillManager } from './temp.ts'
import { resolveRoots } from './roots.ts'

/** Result of a successful install. */
export interface InstallResult {
  /** Whether the skill is now available. */
  readonly installed: true
  /** Kebab-case skill name (catalog name). */
  readonly name: string
  /** Scope the skill was installed into. */
  readonly scope: InstallScope
  /** Absolute directory holding the installed skill. */
  readonly path: string
  /** Routing description from the skill frontmatter. */
  readonly description: string
}

/** Result of a successful removal. */
export interface RemoveResult {
  /** Whether the skill was removed. */
  readonly removed: true
  /** Kebab-case skill name that was removed. */
  readonly name: string
  /** Scope the skill was removed from. */
  readonly scope: InstallScope
}

/** Services the install service needs from the host context. */
export interface InstallServices {
  /** The skill registry; used only for temporary registrations. */
  readonly skills: Pick<Context['skills'], 'register'>
}

/**
 * Install a skill into a managed scope.
 * @param ctx - host context (for skill registration on temp scope).
 * @param config - validated plugin configuration.
 * @param provider - managed provider used to invalidate catalogs.
 * @param tempManager - temporary skill lifecycle manager.
 * @param scope - target scope; falls back to the configured default.
 * @param source - skill source (owner/repo, URL, or owner/repo@skill).
 * @param skillName - exact skill name; optional when the source selects one skill.
 * @param cwd - workspace selector for project scope.
 * @param signal - cancellation signal for CLI work.
 * @param owner - owning session id for temp installs; owned skills are disposed at session end.
 * @returns the install result; throws fail-loud on fetch or validation errors.
 */
export async function installSkill(
  ctx: InstallServices,
  config: Config,
  provider: ManagedSkillProvider,
  tempManager: TempSkillManager,
  scope: InstallScope | undefined,
  source: string,
  skillName: string | undefined,
  cwd?: string,
  signal?: AbortSignal,
  owner?: string,
): Promise<InstallResult> {
  const targetScope = scope ?? config.installDefaultScope ?? 'temp'
  const roots = resolveRoots(config, cwd)
  const fetched = await fetchSkillViaCli(
    config.cliCommand ?? 'npx -y skills@latest',
    source,
    skillName,
    roots.tempSkillDir,
    signal,
  )
  try {
    const skillPath = join(fetched.skillDir, 'SKILL.md')
    const raw = await readFile(skillPath, 'utf8')
    const parsed = parseSkillContent(raw, skillPath)
    const targetRoot = targetScope === 'temp'
      ? roots.tempSkillDir
      : targetScope === 'global'
        ? roots.globalSkillDir
        : roots.projectSkillDir
    const targetDir = join(targetRoot, parsed.name)
    await mkdir(targetRoot, { recursive: true })
    // Replace semantics: a re-install fully replaces the previous bundle.
    await rm(targetDir, { recursive: true, force: true })
    await cp(fetched.skillDir, targetDir, { recursive: true })
    await writeMetadata(targetDir, {
      source,
      ...skillName !== undefined && skillName.length > 0 ? { skill: skillName } : {},
      installedAt: Date.now(),
      scope: targetScope,
    })
    if (targetScope === 'temp') {
      await tempManager.add(
        {
          source: 'custom',
          name: parsed.name,
          description: parsed.description,
          ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
          ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
          content: parsed.content,
        } satisfies SkillRegistration,
        targetDir,
        owner,
      )
    } else {
      provider.notifyChanged()
    }
    return { installed: true, name: parsed.name, scope: targetScope, path: targetDir, description: parsed.description }
  } finally {
    await cleanupFetch(fetched)
  }
}

/**
 * Remove a skill from a managed scope.
 * @param provider - managed provider used to invalidate catalogs.
 * @param tempManager - temporary skill lifecycle manager.
 * @param scope - target scope; when omitted, temp then project then global are tried.
 * @param name - kebab-case skill name to remove.
 * @param cwd - workspace selector for project scope.
 * @returns the removal result; throws when the skill is not found in any scope.
 */
export async function removeSkill(
  provider: ManagedSkillProvider,
  tempManager: TempSkillManager,
  scope: InstallScope | undefined,
  name: string,
  cwd?: string,
): Promise<RemoveResult> {
  const config = providerConfigOf(provider)
  const roots = resolveRoots(config, cwd)
  const scopes: InstallScope[] = scope !== undefined ? [scope] : ['temp', 'project', 'global']
  for (const candidate of scopes) {
    if (candidate === 'temp') {
      if (await tempManager.remove(name)) {
        return { removed: true, name, scope: candidate }
      }
      continue
    }
    const root = candidate === 'global' ? roots.globalSkillDir : roots.projectSkillDir
    const dir = join(root, name)
    const { rm } = await import('node:fs/promises')
    await rm(dir, { recursive: true, force: true })
    if (await dirExists(dir)) continue
    provider.notifyChanged()
    return { removed: true, name, scope: candidate }
  }
  throw new Error(`${name} is not installed in any managed scope`)
}


/** Result of a successful update. */
export interface UpdateResult {
  /** Whether the skill was updated. */
  readonly updated: true
  /** Kebab-case skill name that was updated. */
  readonly name: string
  /** Scope the skill was updated in. */
  readonly scope: InstallScope
}

/**
 * Update a managed skill by re-fetching its recorded source and replacing the
 * installed bundle.
 * @param ctx - host context (for skill registration on temp scope).
 * @param config - validated plugin configuration.
 * @param provider - managed provider used to invalidate catalogs.
 * @param tempManager - temporary skill lifecycle manager.
 * @param scope - target scope; when omitted, temp then project then global are tried.
 * @param name - kebab-case skill name to update.
 * @param cwd - workspace selector for project scope.
 * @param signal - cancellation signal for CLI work.
 * @returns the update result; throws when the skill has no recorded source.
 */
export async function updateSkill(
  ctx: InstallServices,
  config: Config,
  provider: ManagedSkillProvider,
  tempManager: TempSkillManager,
  scope: InstallScope | undefined,
  name: string,
  cwd?: string,
  signal?: AbortSignal,
): Promise<UpdateResult> {
  const roots = resolveRoots(config, cwd)
  const scopes: InstallScope[] = scope !== undefined ? [scope] : ['temp', 'project', 'global']
  const { readMetadata, writeMetadata: persistMetadata } = await import('./metadata.ts')
  for (const candidate of scopes) {
    let dir: string | undefined
    let owner: string | undefined
    if (candidate === 'temp') {
      const entry = tempManager.list().find(item => item.name === name)
      dir = entry?.dir
      owner = entry?.owner
    } else {
      const root = candidate === 'global' ? roots.globalSkillDir : roots.projectSkillDir
      dir = join(root, name)
    }
    if (dir === undefined || !(await dirExists(dir))) continue
    const meta = await readMetadata(dir)
    if (meta === undefined) {
      throw new Error(`${name} (${candidate}) has no recorded source; remove and re-install instead`)
    }
    const fetched = await fetchSkillViaCli(
      config.cliCommand ?? 'npx -y skills@latest',
      meta.source,
      meta.skill,
      roots.tempSkillDir,
      signal,
    )
    try {
      const skillPath = join(fetched.skillDir, 'SKILL.md')
      const raw = await readFile(skillPath, 'utf8')
      const parsed = parseSkillContent(raw, skillPath)
      await rm(dir, { recursive: true, force: true })
      await cp(fetched.skillDir, dir, { recursive: true })
      await persistMetadata(dir, { ...meta, installedAt: Date.now() })
      if (candidate === 'temp') {
        await tempManager.remove(name)
        await tempManager.add(
          {
            source: 'custom',
            name: parsed.name,
            description: parsed.description,
            ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
            ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
            content: parsed.content,
          } satisfies SkillRegistration,
          dir,
          owner,
        )
      } else {
        provider.notifyChanged()
      }
      return { updated: true, name: parsed.name, scope: candidate }
    } finally {
      await cleanupFetch(fetched)
    }
  }
  throw new Error(`${name} is not installed in any managed scope`)
}

async function dirExists(dir: string): Promise<boolean> {
  const { access } = await import('node:fs/promises')
  try {
    await access(dir)
    return true
  } catch {
    return false
  }
}

// The provider is constructed from the validated config; expose it for root resolution.
function providerConfigOf(provider: ManagedSkillProvider): Config {
  return (provider as unknown as { config: Config }).config
}
