/**
 * Pure-function commit summarizer.
 *
 * Given a list of recent commits, tokenize their messages, exclude stopwords
 * and commit-message conventions (Merge, fix, chore etc. when used as the
 * leading verb), and return the top 3 keywords with the number of commits that
 * mentioned each.
 *
 * Used by the LLM analyzer prompt and by the README renderer's "Recent work"
 * section.
 */

import type { CommitEntry, CommitTheme } from '@/lib/types'

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'for', 'of',
  'to', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it',
  'its', 'i', 'we', 'you', 'they', 'he', 'she', 'him', 'her', 'his', 'hers',
  'our', 'ours', 'your', 'yours', 'their', 'theirs', 'so', 'not', 'no',
  'do', 'does', 'did', 'doing', 'have', 'has', 'had', 'having', 'will',
  'would', 'should', 'could', 'can', 'may', 'might', 'must', 'shall',
  'about', 'into', 'over', 'under', 'again', 'more', 'most', 'some', 'any',
  'than', 'too', 'very', 'just', 'also', 'only', 'up', 'down', 'out',
  'how', 'why', 'when', 'where', 'what', 'which', 'who', 'whom',
  'am', 'me', 'my', 'mine', 'us', 'them', 'there', 'here',
  // Common commit prefixes that don't add signal as a keyword
  'feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'build',
  'ci', 'style', 'revert', 'merge', 'pull', 'request', 'pr', 'branch',
  'main', 'master', 'release', 'v1', 'v2', 'add', 'added', 'adds',
  'remove', 'removed', 'removes', 'update', 'updated', 'updates',
  'change', 'changed', 'changes', 'make', 'made', 'makes', 'making',
])

export function tokenizeCommit(text: string): string[] {
  if (!text) return []
  const stripped = text
    .toLowerCase()
    .replace(/[`*_~#\[\](){}|>!]+/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
  const tokens: string[] = []
  const re = /[\p{L}\p{N}]+/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped)) !== null) {
    const tok = m[0]
    if (tok.length < 3) continue
    if (STOP_WORDS.has(tok)) continue
    tokens.push(tok)
  }
  return tokens
}

export interface SummarizeOptions {
  /** Max number of themes to return. Defaults to 3. */
  topK?: number
  /** Min commit count for a theme to be returned. Defaults to 1. */
  minCount?: number
}

export function summarizeCommits(
  commits: CommitEntry[],
  opts: SummarizeOptions = {},
): CommitTheme[] {
  const topK = opts.topK ?? 3
  const minCount = opts.minCount ?? 1
  if (!commits || commits.length === 0) return []

  const counts = new Map<string, { count: number; exampleSha: string }>()
  for (const c of commits) {
    // Use just the first line of the commit message — the rest is body noise.
    const firstLine = (c.message || '').split(/\r?\n/)[0] || ''
    const toks = tokenizeCommit(firstLine)
    // Dedupe within a single commit so a repeated word doesn't double-count.
    const seen = new Set<string>()
    for (const t of toks) {
      if (seen.has(t)) continue
      seen.add(t)
      const existing = counts.get(t)
      if (existing) existing.count++
      else counts.set(t, { count: 1, exampleSha: c.sha })
    }
  }

  const arr = Array.from(counts.entries())
    .map(([keyword, v]) => ({ keyword, count: v.count, exampleSha: v.exampleSha }))
    .filter((t) => t.count >= minCount)
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
    .slice(0, topK)

  return arr
}
