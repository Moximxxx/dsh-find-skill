/**
 * Node half of the dsh-find-skill-client package.
 *
 * The browser contribution lives in ./client.ts behind the `./client` export
 * (see the `dsh.client` manifest in package.json); this node half exists so
 * the loader can resolve the package as a first-class entry.
 *
 * @module dsh-find-skill-client
 */

export const name = 'dsh-find-skill-client'

/**
 * Host-side apply: intentionally a no-op.
 */
export function apply(): void {
  // Client-only package; the browser half registers the conversation node.
}
