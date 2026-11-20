import { test, expect, describe } from 'bun:test'
import { fetchRepoMeta } from '../github-fetcher'
import type { RepoMeta } from '@/lib/types'

/**
 * Mock fetcher. Returns canned JSON for known paths; everything else 404s.
 */
function mockFetcher(routes: Record<string, { status?: number; body: any; headers?: Record<string, string> }>) {
  // Sort keys by descending length so the most-specific path wins. The matcher
  // uses exact equality OR suffix match — never a prefix match — so that
  // `/repos/acme/widget/commits` matches `/commits` instead of `/repos/acme/widget`.
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length)
  const matches = (path: string, key: string) => path === key || path.endsWith(key)
  return async (url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const u = typeof url === 'string' ? url : url.toString()
    const path = u.split('?')[0]
    let matchKey: string | null = null
    for (const key of keys) {
      if (matches(path, key)) {
        matchKey = key
        break
      }
    }
    if (!matchKey) {
      return new Response('Not Found', { status: 404 })
    }
    const route = routes[matchKey]
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json', ...(route.headers || {}) },
    })
  }
}

describe('fetchRepoMeta — happy path (npm repo)', () => {
  test('returns tree, manifest, sourceFiles, commits', async () => {
    const fetcher = mockFetcher({
      '/repos/acme/widget': {
        body: {
          default_branch: 'main',
          description: 'A widget library',
          language: 'TypeScript',
          stargazers_count: 42,
          license: { spdx_id: 'MIT' },
        },
      },
      '/git/trees/main': {
        body: {
          tree: [
            { path: 'src', type: 'tree' },
            { path: 'package.json', type: 'blob', size: 200 },
            { path: 'README.md', type: 'blob', size: 1000 },
            { path: 'src/index.ts', type: 'blob', size: 500 },
            { path: 'src/utils.ts', type: 'blob', size: 300 },
            { path: 'src/big.ts', type: 'blob', size: 9_000 },
          ],
        },
      },
      '/contents/package.json': {
        body: {
          content: Buffer.from(JSON.stringify({
            name: 'widget',
            version: '1.0.0',
            description: 'A widget library',
            license: 'MIT',
            scripts: { dev: 'next dev' },
            dependencies: { next: '^16' },
          })).toString('base64'),
        },
      },
      '/contents/src/utils.ts': {
        body: { content: Buffer.from('export const x = 1').toString('base64') },
      },
      '/contents/src/index.ts': {
        body: { content: Buffer.from('export const y = 2').toString('base64') },
      },
      '/commits': {
        body: [
          { sha: 'aaa', commit: { message: 'feat: init', author: { name: 'dev', date: '2024-01-01T00:00:00Z' } } },
          { sha: 'bbb', commit: { message: 'fix: bug', author: { name: 'dev2', date: '2024-01-02T00:00:00Z' } } },
        ],
      },
    })
    const result = await fetchRepoMeta('acme', 'widget', { fetcher })
    expect(result.rateLimited).toBe(false)
    expect(result.meta.owner).toBe('acme')
    expect(result.meta.name).toBe('widget')
    expect(result.meta.defaultBranch).toBe('main')
    expect(result.meta.description).toBe('A widget library')
    expect(result.meta.language).toBe('TypeScript')
    expect(result.meta.stars).toBe(42)
    expect(result.meta.license).toBe('MIT')
    expect(result.meta.tree.length).toBeGreaterThan(0)
    expect(result.meta.manifest).not.toBeNull()
    expect(result.meta.manifest!.ecosystem).toBe('npm')
    expect(result.meta.manifest!.name).toBe('widget')
    expect(result.meta.sourceFiles.length).toBeGreaterThan(0)
    expect(result.meta.commits).toHaveLength(2)
  })
})

describe('fetchRepoMeta — Python repo without package.json', () => {
  test('handles missing manifest (manifest is null)', async () => {
    const fetcher = mockFetcher({
      '/repos/acme/pyapp': {
        body: { default_branch: 'main', description: 'Python project', language: 'Python', license: null },
      },
      '/git/trees/main': {
        body: {
          tree: [
            { path: 'pyapp', type: 'tree' },
            { path: 'main.py', type: 'blob', size: 200 },
            { path: 'README.md', type: 'blob', size: 1000 },
          ],
        },
      },
      '/contents/main.py': {
        body: { content: Buffer.from('print("hi")').toString('base64') },
      },
      '/commits': {
        body: [{ sha: 'abc', commit: { message: 'init', author: { name: 'dev', date: '' } } }],
      },
    })
    const result = await fetchRepoMeta('acme', 'pyapp', { fetcher })
    expect(result.meta.manifest).toBeNull()
    expect(result.missingParts).toContain('manifest')
    expect(result.meta.commits).toHaveLength(1)
  })
})

describe('fetchRepoMeta — 404 on repo', () => {
  test('surfaces missing repo in missingParts and returns empty meta', async () => {
    const fetcher = mockFetcher({
      '/repos/missing/repo': { status: 404, body: { message: 'Not Found' } },
    })
    const result = await fetchRepoMeta('missing', 'repo', { fetcher })
    expect(result.meta.tree).toEqual([])
    expect(result.meta.commits).toEqual([])
    expect(result.missingParts).toContain('repo')
  })
})

describe('fetchRepoMeta — rate limited', () => {
  test('rate-limited repo endpoint sets rateLimited=true', async () => {
    const fetcher = mockFetcher({
      '/repos/limited/repo': {
        status: 403,
        body: { message: 'API rate limit exceeded' },
        headers: { 'x-ratelimit-remaining': '0' },
      },
    })
    const result = await fetchRepoMeta('limited', 'repo', { fetcher })
    expect(result.rateLimited).toBe(true)
    expect(result.missingParts).toContain('repo')
  })
})

describe('fetchRepoMeta — 404 on tree', () => {
  test('handles missing tree without throwing', async () => {
    const fetcher = mockFetcher({
      '/repos/acme/tree-missing': {
        body: { default_branch: 'main', description: 'no tree', language: 'Go' },
      },
      '/git/trees/main': { status: 404, body: { message: 'Not Found' } },
      '/commits': { body: [] },
    })
    const result = await fetchRepoMeta('acme', 'tree-missing', { fetcher })
    expect(result.meta.tree).toEqual([])
    expect(result.missingParts).toContain('tree')
  })
})
