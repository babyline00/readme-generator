/**
 * Parses a GitHub URL or SSH address into { owner, name }.
 *
 * Accepted forms:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/branch
 *   https://github.com/owner/repo.git
 *   git@github.com:owner/repo.git
 *   git+ssh://git@github.com/owner/repo.git
 *
 * Rejects non-github.com hosts (including GitLab, Bitbucket, etc.) and
 * returns null for any input that doesn't match.
 */

export interface ParsedRepo {
  owner: string
  name: string
}

const NAME_RE = /^[A-Za-z0-9._-]+$/

export function parseRepoUrl(input: string): ParsedRepo | null {
  if (!input || typeof input !== 'string') return null
  const raw = input.trim()
  if (raw.length === 0) return null

  // SSH form: git@github.com:owner/repo(.git)
  const sshMatch = raw.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (sshMatch) {
    const owner = sshMatch[1]
    const name = sshMatch[2]
    if (NAME_RE.test(owner) && NAME_RE.test(name)) return { owner, name }
  }

  // URL form. We accept http(s) and git+ssh://git@github.com/owner/repo
  let url: URL | null = null
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  // Allow only github.com (reject enterprise hosts, GitLab, Bitbucket).
  if (url.hostname !== 'github.com') return null

  // Path could be /owner/repo, /owner/repo/tree/branch, /owner/repo.git, /owner/repo/
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return null

  const owner = parts[0]
  let name = parts[1]
  // Strip an optional trailing .git suffix
  if (name.endsWith('.git')) name = name.slice(0, -4)

  // Reject dotfiles/special paths like /.github or owner/.github
  if (!NAME_RE.test(owner) || !NAME_RE.test(name)) return null
  if (owner.startsWith('.') || name.startsWith('.')) return null

  return { owner, name }
}

/** Builds the canonical https URL for a repo. */
export function repoUrl(owner: string, name: string): string {
  return `https://github.com/${owner}/${name}`
}
