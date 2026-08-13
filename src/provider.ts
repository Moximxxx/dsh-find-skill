/**
 * Managed skill provider: exposes plugin-owned project/global roots through
 * ctx.skills, isolated from hand-written .dsh/skills and shared .agents/skills.
 *
 * @module dsh-find-skill/provider
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
} from '@deepseek-ai/dsh-skill'
import type { Config } from './config.ts'
import { parseSkillContent } from './frontmatter.ts'
import type { ManagedRoots } from './roots.ts'

/** Opaque locator handed back to get() by the managed provider. */
export interface ManagedLocator {
  /** Absolute path of the skill directory. */
  readonly path: string
}

/** Provider-side invalidation handle captured at registration. */
export type Invalidate = () => void

/**
 * Provider exposing plugin-managed skill directories to ctx.skills.
 * Roots are resolved per lookup so project skills follow the calling agent's cwd.
 */
export class ManagedSkillProvider implements SkillProvider {
  readonly name = 'dsh-find-skill'

  /**
   * Create the managed provider.
   * @param config - validated plugin configuration.
   * @param invalidate - registration-scoped catalog invalidation callback.
   */
  private readonly config: Config
  private readonly invalidate: Invalidate

  constructor(config: Config, invalidate: Invalidate) {
    this.config = config
    this.invalidate = invalidate
  }

  /**
   * Scan managed roots for skill candidates.
   * @param options - lookup options; cwd selects the project root.
   * @returns all managed candidates for the resolved workspace.
   */
  async list(options: SkillLookupOptions): Promise<SkillCandidate[]> {
    const roots = await import('./roots.ts').then(m => m.resolveRoots(this.config, options.cwd))
    const candidates: SkillCandidate[] = []
    for (const root of [roots.projectSkillDir, roots.globalSkillDir]) {
      const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const skillDir = join(root, entry.name)
        const skillPath = join(skillDir, 'SKILL.md')
        const raw = await readFile(skillPath, 'utf8').catch(() => undefined)
        if (raw === undefined) continue
        const parsed = parseSkillContent(raw, skillPath)
        candidates.push({
          name: parsed.name,
          description: parsed.description,
          ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
          invocation: {
            modelInvocable: parsed.modelInvocable,
            userInvocable: parsed.userInvocable,
          },
          source: 'custom',
          provider: this.name,
          rank: this.config.providerRank ?? 350,
          locator: { path: skillDir },
          path: skillPath,
          ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
          resourceBase: { kind: 'directory', path: skillDir },
        })
      }
    }
    return candidates
  }

  /**
   * Load the full body of one managed skill.
   * @param candidate - the winning candidate from this provider.
   * @returns the complete skill definition, or undefined if the file disappeared.
   */
  async get(candidate: SkillCandidate): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator as ManagedLocator
    const skillPath = join(locator.path, 'SKILL.md')
    const raw = await readFile(skillPath, 'utf8').catch(() => undefined)
    if (raw === undefined) return undefined
    const parsed = parseSkillContent(raw, skillPath)
    return {
      name: parsed.name,
      description: parsed.description,
      ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
      invocation: {
        modelInvocable: parsed.modelInvocable,
        userInvocable: parsed.userInvocable,
      },
      source: 'custom',
      provider: this.name,
      ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
      resourceBase: { kind: 'directory', path: locator.path },
      path: skillPath,
      content: parsed.content,
    }
  }

  /**
   * Notify the registry that managed roots changed on disk.
   */
  notifyChanged(): void {
    this.invalidate()
  }
}

/**
 * Register the managed provider on ctx.skills.
 * @param registerProvider - the registry's registerProvider function.
 * @param config - validated plugin configuration.
 * @returns the provider instance plus its registration disposer.
 */
export function registerManagedProvider(
  registerProvider: (create: (control: SkillProviderControl) => SkillProvider) => () => void,
  config: Config,
): { provider: ManagedSkillProvider; dispose: () => void } {
  let provider!: ManagedSkillProvider
  const dispose = registerProvider((control) => {
    provider = new ManagedSkillProvider(config, () => control.invalidate())
    return provider
  })
  return { provider, dispose }
}

/** Resolve managed roots for display and mutation call sites. */
export async function rootsFor(config: Config, cwd?: string): Promise<ManagedRoots> {
  const { resolveRoots } = await import('./roots.ts')
  return resolveRoots(config, cwd)
}
