/**
 * Compaction policy application for temporary skills.
 *
 * @module dsh-find-skill/lifecycle
 */

import type { CompactDisposePolicy } from './config.ts'

/** Dispose the temporary skills owned by one session. */
export type DisposeOwned = (owner: string) => Promise<boolean>

/** Ask the user whether to clean up; resolves to true when cleanup was chosen. */
export type AskCleanup = () => Promise<boolean>

/**
 * Apply a compaction policy for one session's temporary skills.
 * @param policy - configured policy (keep | dispose | ask).
 * @param owner - the session id owning the skills.
 * @param disposeOwned - session-scoped disposal function.
 * @param ask - user question used only by the 'ask' policy; must fail closed.
 * @returns a promise settling when the policy was applied.
 */
export async function applyCompactPolicy(
  policy: CompactDisposePolicy,
  owner: string,
  disposeOwned: DisposeOwned,
  ask: AskCleanup,
): Promise<void> {
  if (policy === 'dispose') {
    await disposeOwned(owner)
    return
  }
  if (policy === 'ask') {
    // Fail closed: any ask error keeps the skills.
    try {
      if (await ask()) await disposeOwned(owner)
    } catch {
      // keep
    }
  }
}
