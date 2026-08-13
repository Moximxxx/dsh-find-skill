/**
 * dsh-find-skill: bridge the vercel-labs/skills ecosystem into dsh.
 *
 * The plugin exposes model-facing search/install/remove tools, a human-facing
 * /skill command, and a managed skill provider. Skills install into
 * plugin-owned roots (temp / project / global), isolated from hand-written
 * .dsh/skills and shared .agents/skills directories.
 *
 * @module dsh-find-skill
 */

import type { Context } from '@deepseek-ai/cordis'
import { applyCompactPolicy } from './lifecycle.ts'
import { registerManagedProvider } from './provider.ts'
import { TempSkillManager } from './temp.ts'
import { registerTools } from './tools.ts'
import { registerCommand } from './command.ts'
import { resolveRoots } from './roots.ts'
import { Config, type CompactDisposePolicy, type InstallScope } from './config.ts'

export { Config }
export type { CompactDisposePolicy, InstallScope } from './config.ts'

export const name = 'dsh-find-skill'

/** Services required by the plugin. */
export const inject = ['tools', 'skills'] as const

/**
 * Register the dsh-find-skill plugin: managed provider, model tools, the
 * /skill command, and temporary-skill lifecycle wiring.
 * @param ctx - the Cordis context hosting this plugin.
 * @param config - validated deployment configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const validated = Config(config)
  ctx.logger('dsh-find-skill').info('dsh-find-skill loaded')

  // Managed provider over self-owned project/global roots.
  const { provider } = registerManagedProvider(
    (create) => ctx.skills.registerProvider(create),
    validated,
  )

  // Temporary skill manager; temp roots resolve per call site.
  const roots = resolveRoots(validated)
  const tempManager = new TempSkillManager(
    (skill) => ctx.skills.register(skill),
    roots.tempSkillDir,
  )

  registerTools(ctx, validated, provider, tempManager)
  registerCommand(ctx, validated, provider, tempManager)

  // Session-end cleanup: dispose temporary skills owned by the ending session.
  ctx.on('session/disposed', (session: { readonly id: string }) => {
    void tempManager.disposeOwned(session.id)
  })

  // Compaction policy: session-scoped disposal, optionally asking the user.
  ctx.on('session/event', async (session, event) => {
    // compaction/* event types are declared by the optional dsh-compaction package.
    if ((event as { type: string }).type !== 'compaction/start') return
    const policy: CompactDisposePolicy = validated.compactDisposePolicy ?? 'keep'
    const owner = String((session as { id: unknown }).id)
    await applyCompactPolicy(
      policy,
      owner,
      (sessionOwner) => tempManager.disposeOwned(sessionOwner),
      async () => {
        const userQuestions = ctx.get('userQuestions') as
          | { ask: (options: unknown) => Promise<{ answers: Array<{ selected: string[] }> }> }
          | undefined
        if (userQuestions === undefined) return false
        const result = await userQuestions.ask({
          questions: [{
            id: 'dsh-find-skill-compact',
            question: '会话即将压缩：是否清理本会话安装的临时技能？',
            header: '临时技能清理',
            options: [
              { label: '保留', description: '临时技能在压缩后继续可用' },
              { label: '清理', description: '移除本会话的临时技能及其物化目录' },
            ],
          }],
        })
        return result.answers[0]?.selected.includes('清理') ?? false
      },
    )
  })
}
