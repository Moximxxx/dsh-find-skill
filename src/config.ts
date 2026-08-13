/**
 * Configuration for the dsh-find-skill plugin.
 *
 * @module dsh-find-skill/config
 */

import Schema from '@deepseek-ai/schemastery'

/** Installation scope for a skill managed by this plugin. */
export type InstallScope = 'temp' | 'project' | 'global'

/** Compaction behavior for temporary skills. */
export type CompactDisposePolicy = 'keep' | 'dispose'

/** Deployment configuration for the dsh-find-skill plugin. */
export interface Config {
  /** Base URL of the skills.sh search API (same source the official CLI `find` uses). */
  readonly searchApiBase?: string
  /** Maximum remote search candidates returned per query. */
  readonly searchLimit?: number
  /** Command running the official `skills` CLI; defaults to the latest version via npx. */
  readonly cliCommand?: string
  /** Default scope when the model installs a skill without an explicit scope. */
  readonly installDefaultScope?: InstallScope
  /** Project-scoped managed skill root, relative to the project root. */
  readonly projectSkillRoot?: string
  /** Global managed skill root; defaults to <dshHome>/skills-bridge/global. */
  readonly globalSkillRoot?: string
  /** Temporary materialization root; defaults to <dshHome>/skills-bridge/tmp. */
  readonly tempSkillRoot?: string
  /** Rank for candidates exposed by the managed provider (lower wins duplicates). */
  readonly providerRank?: number
  /** What happens to temporary skills when a session compacts. */
  readonly compactDisposePolicy?: CompactDisposePolicy
  /** Whether the model-facing `skill_find` tool is registered. */
  readonly registerFindTool?: boolean
  /** Whether the model-facing `skill_install` tool is registered. */
  readonly registerInstallTool?: boolean
  /** Whether the model-facing `skill_remove` tool is registered. */
  readonly registerRemoveTool?: boolean
  /** Whether the human-facing `/skill` command family is registered. */
  readonly registerCommand?: boolean
}

/** Validated schema for {@link Config}; defaults fill every documented field. */
export const Config: Schema<Config> = Schema.object({
  searchApiBase: Schema.string().default('https://skills.sh'),
  searchLimit: Schema.number().min(1).max(100).default(20),
  cliCommand: Schema.string().default('npx -y skills@latest'),
  installDefaultScope: Schema.union(['temp', 'project', 'global'] as const).default('temp'),
  projectSkillRoot: Schema.string().default('.dsh/skills-bridge'),
  globalSkillRoot: Schema.string(),
  tempSkillRoot: Schema.string(),
  providerRank: Schema.number().min(1).max(1000).default(350),
  compactDisposePolicy: Schema.union(['keep', 'dispose'] as const).default('keep'),
  registerFindTool: Schema.boolean().default(true),
  registerInstallTool: Schema.boolean().default(true),
  registerRemoveTool: Schema.boolean().default(true),
  registerCommand: Schema.boolean().default(true),
})
