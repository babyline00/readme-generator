/**
 * GitHub REST API client (unauthenticated — 60 req/hr rate limit).
 *
 * The fetcher is injectable so unit tests can pass a mock. It fetches:
 *   - repo metadata (description, language, stars, license, default branch)
 *   - the recursive git tree (top-level files + dir names)
 *   - the recognised manifest (package.json / pyproject.toml / Cargo.toml / go.mod)
 *   - top 5 small source files (sorted by size asc, capped at ~30KB total)
 *   - last 30 commits on the default branch
 *
 * Designed to be resilient: a missing manifest (Python repo without pyproject.toml),
 * a 404 on the tree, or a rate-limit response are all handled gracefully and
 * surfaced as null / empty fields rather than throwing.
 */

import type { CommitEntry, ManifestInfo, RepoMeta, SourceFile, TreeEntry } from '@/lib/types'
import { parseManifest } from '@/lib/package-json-parser'

const DEFAULT_BASE = 'https://api.github.com'

export interface FetchOptions {
  /** Custom fetch (used for tests). Defaults to global fetch. */
  fetcher?: typeof fetch
  /** GitHub API base URL. Defaults to https://api.github.com. */
  baseUrl?: string
  /** Optional GitHub token — bumps rate limit from 60 to 5,000 req/hr. */
  token?: string
}

export interface FetchResult {
  meta: RepoMeta
  /** Set when a request hit the GitHub rate limit. The caller can show a banner. */
  rateLimited: boolean
  /** Set when one or more requests returned 404 (e.g. tree missing). */
  missingParts: string[]
  /** Remaining requests in the rate-limit window. */
  rateLimitRemaining?: number
}

export async function fetchRepoMeta(
  owner: string,
  name: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const base = opts.baseUrl ?? process.env.GITHUB_API_BASE ?? DEFAULT_BASE
  const fetcher = opts.fetcher ?? fetch
  const token = opts.token ?? process.env.GITHUB_TOKEN
  const missingParts: string[] = []
  let rateLimited = false
  let rateLimitRemaining: number | undefined

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'readme-generator-copilot',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  // 1. Repo metadata
  const repoRes = await fetcher(`${base}/repos/${owner}/${name}`, { headers })
  rateLimitRemaining = parseRateRemaining(repoRes)
  if (repoRes.status === 403 && isRateLimited(repoRes)) {
    rateLimited = true
    return {
      meta: emptyMeta(owner, name),
      rateLimited,
      missingParts: ['repo'],
      rateLimitRemaining,
    }
  }
  if (repoRes.status === 404) {
    missingParts.push('repo')
    return {
      meta: emptyMeta(owner, name),
      rateLimited,
      missingParts,
      rateLimitRemaining,
    }
  }
  if (!repoRes.ok) {
    throw new Error(`GitHub API error fetching repo: ${repoRes.status} ${repoRes.statusText}`)
  }
  const repoJson = await repoRes.json() as any
  const defaultBranch: string = repoJson.default_branch || 'main'
  const description: string | undefined = repoJson.description ?? undefined
  const language: string | undefined = repoJson.language ?? undefined
  const stars: number | undefined = typeof repoJson.stargazers_count === 'number' ? repoJson.stargazers_count : undefined
  const license: string | undefined = repoJson.license?.spdx_id && repoJson.license.spdx_id !== 'NOASSERTION' ? repoJson.license.spdx_id : undefined

  // 2. Tree (recursive)
  const treeUrl = `${base}/repos/${owner}/${name}/git/trees/${defaultBranch}?recursive=1`
  const treeRes = await fetcher(treeUrl, { headers })
  rateLimitRemaining = parseRateRemaining(treeRes)
  let tree: TreeEntry[] = []
  if (treeRes.status === 404 || treeRes.status === 409) {
    missingParts.push('tree')
  } else if (treeRes.status === 403 && isRateLimited(treeRes)) {
    rateLimited = true
    missingParts.push('tree')
  } else if (treeRes.ok) {
    const treeJson = await treeRes.json() as any
    if (Array.isArray(treeJson.tree)) {
      tree = treeJson.tree
        .filter((e: any) => typeof e.path === 'string' && (e.type === 'blob' || e.type === 'tree'))
        .map((e: any) => ({
          path: e.path,
          type: e.type === 'tree' ? 'tree' : 'blob',
          size: typeof e.size === 'number' ? e.size : undefined,
        }))
    }
  } else {
    missingParts.push('tree')
  }

  // 3. Manifest — try each well-known filename in the tree root.
  const manifestCandidates = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']
  let manifest: ManifestInfo | null = null
  for (const filename of manifestCandidates) {
    const entry = tree.find((e) => e.path === filename && e.type === 'blob')
    if (!entry) continue
    const rawUrl = `${base}/repos/${owner}/${name}/contents/${filename}?ref=${defaultBranch}`
    const rawRes = await fetcher(rawUrl, { headers })
    rateLimitRemaining = parseRateRemaining(rawRes)
    if (!rawRes.ok) {
      if (rawRes.status === 403 && isRateLimited(rawRes)) {
        rateLimited = true
        missingParts.push('manifest')
      }
      continue
    }
    const rawJson = await rawRes.json() as any
    if (!rawJson || typeof rawJson.content !== 'string') continue
    const text = Buffer.from(rawJson.content, 'base64').toString('utf8')
    const parsed = parseManifest(text, filename)
    if (parsed) {
      manifest = parsed
      break
    }
  }
  if (!manifest) missingParts.push('manifest')

  // 4. Top 5 small source files (cap ~30KB total) — only fetch if we have a tree.
  const sourceFiles: SourceFile[] = []
  if (tree.length > 0 && !rateLimited) {
    const candidates = tree
      .filter((e) => e.type === 'blob' && typeof e.size === 'number' && e.size > 0)
      .filter((e) => isLikelySourceFile(e.path))
      .filter((e) => (e.size ?? 0) <= 10_000) // individual cap
      .sort((a, b) => (a.size ?? 0) - (b.size ?? 0))
      .slice(0, 5)

    let totalSize = 0
    for (const entry of candidates) {
      const size = entry.size ?? 0
      if (totalSize + size > 30_000) break
      const rawUrl = `${base}/repos/${owner}/${name}/contents/${entry.path}?ref=${defaultBranch}`
      let rawRes: Response
      try {
        rawRes = await fetcher(rawUrl, { headers })
      } catch {
        continue
      }
      rateLimitRemaining = parseRateRemaining(rawRes)
      if (!rawRes.ok) {
        if (rawRes.status === 403 && isRateLimited(rawRes)) rateLimited = true
        continue
      }
      const rawJson = await rawRes.json() as any
      if (!rawJson || typeof rawJson.content !== 'string') continue
      try {
        const content = Buffer.from(rawJson.content, 'base64').toString('utf8')
        sourceFiles.push({
          path: entry.path,
          language: languageFromExtension(entry.path),
          content,
          size,
        })
        totalSize += size
      } catch {
        // ignore decode errors
      }
    }
  }

  // 5. Last 30 commits
  let commits: CommitEntry[] = []
  if (!rateLimited) {
    const commitsUrl = `${base}/repos/${owner}/${name}/commits?per_page=30`
    const commitsRes = await fetcher(commitsUrl, { headers })
    rateLimitRemaining = parseRateRemaining(commitsRes)
    if (commitsRes.status === 403 && isRateLimited(commitsRes)) {
      rateLimited = true
      missingParts.push('commits')
    } else if (commitsRes.status === 404) {
      missingParts.push('commits')
    } else if (commitsRes.ok) {
      const arr = await commitsRes.json() as any[]
      if (Array.isArray(arr)) {
        commits = arr
          .slice(0, 30)
          .map((c) => ({
            sha: typeof c.sha === 'string' ? c.sha : '',
            message: typeof c.commit?.message === 'string' ? c.commit.message : '',
            author:
              (typeof c.commit?.author?.name === 'string' && c.commit.author.name) ||
              (typeof c.author?.login === 'string' && c.author.login) ||
              'unknown',
            date: typeof c.commit?.author?.date === 'string' ? c.commit.author.date : '',
          }))
          .filter((c) => c.sha)
      }
    }
  }

  return {
    meta: {
      owner,
      name,
      url: `https://github.com/${owner}/${name}`,
      defaultBranch,
      description,
      language,
      stars,
      license,
      tree,
      manifest,
      sourceFiles,
      commits,
    },
    rateLimited,
    missingParts,
    rateLimitRemaining,
  }
}

function emptyMeta(owner: string, name: string): RepoMeta {
  return {
    owner,
    name,
    url: `https://github.com/${owner}/${name}`,
    defaultBranch: 'main',
    tree: [],
    manifest: null,
    sourceFiles: [],
    commits: [],
  }
}

function parseRateRemaining(res: Response): number | undefined {
  const v = res.headers.get('x-ratelimit-remaining')
  if (v == null) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function isRateLimited(res: Response): boolean {
  const remaining = res.headers.get('x-ratelimit-remaining')
  if (remaining === '0') return true
  // GitHub sometimes returns 403 with a 403 body for rate-limited requests.
  return res.status === 403 && remaining === '0'
}

const SOURCE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'kt',
  'swift', 'rb', 'php', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'scala', 'sh',
  'vue', 'svelte', 'astro', 'md', 'txt', 'toml', 'yaml', 'yml', 'json',
])

function isLikelySourceFile(path: string): boolean {
  if (!path) return false
  // Skip obvious noise — lockfiles, generated dirs, vendored.
  if (path.includes('node_modules/')) return false
  if (path.includes('vendor/')) return false
  if (path.includes('dist/')) return false
  if (path.includes('build/')) return false
  if (path.includes('.next/')) return false
  if (path.endsWith('.lock')) return false
  if (path.endsWith('-lock.json')) return false
  if (path.endsWith('.min.js')) return false
  if (path.endsWith('.min.css')) return false
  const ext = path.split('.').pop()?.toLowerCase()
  if (!ext) return false
  return SOURCE_EXTENSIONS.has(ext)
}

export function languageFromExtension(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript',
    cjs: 'javascript', py: 'python', rs: 'rust', go: 'go', java: 'java',
    kt: 'kotlin', swift: 'swift', rb: 'ruby', php: 'php', c: 'c', cc: 'cpp',
    cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp', scala: 'scala', sh: 'bash',
    vue: 'vue', svelte: 'svelte', astro: 'astro', md: 'markdown', toml: 'toml',
    yaml: 'yaml', yml: 'yaml', json: 'json',
  }
  return map[ext] || 'text'
}
