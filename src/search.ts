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

/** Default source owners boosted in result ranking. */
export const DEFAULT_PRIORITY_SOURCES = ['vercel-labs', 'vercel', 'anthropics', 'microsoft', 'google', 'github']

/**
 * Rank candidates: priority sources first, then by install count descending.
 * @param candidates - raw candidates from the search API.
 * @param prioritySources - source owners boosted to the front (compared by owner segment).
 * @returns the re-ranked candidate list (stable within equal keys).
 */
export function rankCandidates(candidates: SearchCandidate[], prioritySources: string[]): SearchCandidate[] {
  const priorities = new Set(prioritySources.map(source => source.toLowerCase()))
  const key = (candidate: SearchCandidate): number => {
    const owner = candidate.source.split('/')[0]?.toLowerCase() ?? ''
    return priorities.has(owner) ? 0 : 1
  }
  return [...candidates].sort((a, b) => {
    const rankDelta = key(a) - key(b)
    return rankDelta !== 0 ? rankDelta : b.installs - a.installs
  })
}

/**
 * Query the skills.sh search API.
 * @param base - API base URL (defaults to the official skills.sh host).
 * @param query - search keywords.
 * @param limit - maximum candidates to request.
 * @param owner - optional GitHub owner filter.
 * @param signal - cancellation signal forwarded to the fetch.
 * @param prioritySources - source owners boosted to the front of results.
 * @returns normalized, ranked remote candidates, or an empty list on non-OK responses.
 */
export async function searchSkills(
  base: string,
  query: string,
  limit: number,
  owner?: string,
  signal?: AbortSignal,
  prioritySources: string[] = DEFAULT_PRIORITY_SOURCES,
): Promise<SearchCandidate[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  if (owner !== undefined && owner.length > 0) params.set('owner', owner)
  const url = `${normalizeBase(base)}/api/search?${params.toString()}`
  const response = await fetch(url, { signal })
  if (!response.ok) return []
  const data = (await response.json()) as SearchApiResponse
  const candidates = (data.skills ?? []).map(skill => ({
    id: skill.id,
    name: skill.name,
    installs: skill.installs,
    source: skill.source,
    url: `${normalizeBase(base)}/${skill.source}/${skill.id}`,
  }))
  return rankCandidates(candidates, prioritySources)
}
