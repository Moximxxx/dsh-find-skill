/**
 * Remote skill search over the skills.sh API (the same source the official
 * skills find CLI command queries).
 *
 * @module dsh-find-skill/search
 */

/** One remote search candidate from the skills.sh API. */
export interface SearchCandidate {
  /** Skill identifier used in install commands and URLs. */
  readonly id: string
  /** Display name from the skill frontmatter. */
  readonly name: string
  /** Total reported install count. */
  readonly installs: number
  /** Source repository, e.g. vercel-labs/agent-skills. */
  readonly source: string
  /** Browse URL on skills.sh. */
  readonly url: string
}

interface SearchApiResponse {
  skills?: Array<{ id: string; name: string; installs: number; source: string }>
}

function normalizeBase(base: string): string {
  return base.endsWith('/') ? base.slice(0, -1) : base
}

/**
 * Query the skills.sh search API.
 * @param base - API base URL (defaults to the official skills.sh host).
 * @param query - search keywords.
 * @param limit - maximum candidates to request.
 * @param owner - optional GitHub owner filter.
 * @param signal - cancellation signal forwarded to the fetch.
 * @returns normalized remote candidates, or an empty list on non-OK responses.
 */
export async function searchSkills(
  base: string,
  query: string,
  limit: number,
  owner?: string,
  signal?: AbortSignal,
): Promise<SearchCandidate[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  if (owner !== undefined && owner.length > 0) params.set('owner', owner)
  const url = `${normalizeBase(base)}/api/search?${params.toString()}`
  const response = await fetch(url, { signal })
  if (!response.ok) return []
  const data = (await response.json()) as SearchApiResponse
  return (data.skills ?? []).map(skill => ({
    id: skill.id,
    name: skill.name,
    installs: skill.installs,
    source: skill.source,
    url: `${normalizeBase(base)}/${skill.source}/${skill.id}`,
  }))
}
