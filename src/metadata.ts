/**
 * Per-install provenance metadata stored inside managed skill directories so
 * update can re-fetch the same source.
 *
 * @module dsh-find-skill/metadata
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstallScope } from './config.ts'

/** Metadata file name inside each managed skill directory. */
export const METADATA_FILE = '.dsh-find-skill.json'

/** Provenance of one managed skill install. */
export interface InstallMetadata {
  /** Skill source passed to the CLI (owner/repo, URL, or owner/repo@skill). */
  readonly source: string
  /** Exact skill name filter used at install time, when any. */
  readonly skill?: string
  /** Unix epoch milliseconds when the skill was installed. */
  readonly installedAt: number
  /** Scope the skill was installed into. */
  readonly scope: InstallScope
}

/**
 * Write install metadata into a managed skill directory.
 * @param dir - the managed skill directory.
 * @param meta - provenance to persist.
 * @returns a promise settling when the metadata file is written.
 */
export async function writeMetadata(dir: string, meta: InstallMetadata): Promise<void> {
  await writeFile(join(dir, METADATA_FILE), JSON.stringify(meta, null, 2), 'utf8')
}

/**
 * Read install metadata from a managed skill directory.
 * @param dir - the managed skill directory.
 * @returns the parsed provenance, or undefined when missing or malformed.
 */
export async function readMetadata(dir: string): Promise<InstallMetadata | undefined> {
  try {
    const raw = await readFile(join(dir, METADATA_FILE), 'utf8')
    const parsed = JSON.parse(raw) as Partial<InstallMetadata>
    if (typeof parsed.source !== 'string' || parsed.source.length === 0) return undefined
    if (typeof parsed.installedAt !== 'number') return undefined
    if (parsed.scope !== 'temp' && parsed.scope !== 'project' && parsed.scope !== 'global') return undefined
    return {
      source: parsed.source,
      ...parsed.skill !== undefined && typeof parsed.skill === 'string' ? { skill: parsed.skill } : {},
      installedAt: parsed.installedAt,
      scope: parsed.scope,
    }
  } catch {
    return undefined
  }
}
