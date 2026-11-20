import { test, expect, describe } from 'bun:test'
import { summarizeCommits, tokenizeCommit } from '../commit-summarizer'
import type { CommitEntry } from '@/lib/types'

function commit(sha: string, message: string, author = 'dev'): CommitEntry {
  return { sha, message, author, date: '2024-01-01T00:00:00Z' }
}

describe('tokenizeCommit', () => {
  test('lowercases and splits', () => {
    expect(tokenizeCommit('Fix memory leak in parser')).toContain('memory')
    expect(tokenizeCommit('Fix memory leak in parser')).toContain('parser')
  })
  test('drops short tokens and stop words', () => {
    const toks = tokenizeCommit('feat: add a new thing')
    // 'feat' is a stop word, 'add' is a stop word, 'new' would be kept (>= 3 chars)
    expect(toks).not.toContain('feat')
    expect(toks).not.toContain('add')
    expect(toks).toContain('new')
  })
  test('strips markdown control chars', () => {
    // `*` and `_` are stripped before tokenizing, so the inner words survive.
    expect(tokenizeCommit('fix: **bold** _italic_')).toEqual(['bold', 'italic'])
  })
})

describe('summarizeCommits', () => {
  test('returns top-3 keywords by frequency', () => {
    const commits = [
      commit('a1', 'feat: add database connection pooling'),
      commit('a2', 'fix: database timeout on heavy queries'),
      commit('a3', 'feat: database migrations runner'),
      commit('a4', 'docs: update README'),
      commit('a5', 'fix: render latency in dashboard'),
      commit('a6', 'feat: dashboard widgets'),
    ]
    const themes = summarizeCommits(commits)
    expect(themes.length).toBeLessThanOrEqual(3)
    // "database" appears in 3 commits → should be top
    expect(themes[0].keyword).toBe('database')
    expect(themes[0].count).toBe(3)
  })
  test('returns [] for empty input', () => {
    expect(summarizeCommits([])).toEqual([])
  })
  test('respects topK option', () => {
    const commits = [
      commit('a1', 'fix memory'),
      commit('a2', 'fix memory'),
      commit('a3', 'fix cache'),
      commit('a4', 'fix cache'),
      commit('a5', 'fix logger'),
      commit('a6', 'fix logger'),
    ]
    const themes = summarizeCommits(commits, { topK: 2 })
    expect(themes).toHaveLength(2)
  })
  test('dedupes within a single commit', () => {
    const commits = [commit('a1', 'cache cache cache')]
    const themes = summarizeCommits(commits)
    // The word "cache" appears three times in one commit but should count as 1.
    expect(themes[0].count).toBe(1)
  })
  test('uses first line only', () => {
    const commits = [
      commit('a1', 'feat: search\n\nLong body about search indexing that mentions search again and again.'),
      commit('a2', 'fix: search pagination'),
    ]
    const themes = summarizeCommits(commits)
    expect(themes[0].keyword).toBe('search')
    expect(themes[0].count).toBe(2) // not 4 — the body of a1 is ignored
  })
  test('returns exampleSha for each theme', () => {
    const commits = [commit('sha-aaa', 'feat: caching layer')]
    const themes = summarizeCommits(commits)
    expect(themes[0].exampleSha).toBe('sha-aaa')
  })
})
