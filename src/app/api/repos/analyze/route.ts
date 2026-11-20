import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseRepoUrl } from '@/lib/url-parser'
import { fetchRepoMeta } from '@/lib/github-fetcher'
import { analyzeRepo } from '@/lib/analyzer'
import { renderReadme } from '@/lib/readme-renderer'
import type { RepoMeta, Section } from '@/lib/types'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  let body: { url?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const url = body?.url
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'Missing required field: url' }, { status: 400 })
  }

  const parsed = parseRepoUrl(url)
  if (!parsed) {
    return NextResponse.json(
      { error: 'Invalid GitHub URL. Expected https://github.com/owner/repo or git@github.com:owner/repo.git' },
      { status: 400 },
    )
  }

  const { owner, name } = parsed

  // 1. Fetch repo metadata + tree + manifest + source files + commits.
  let fetchResult
  try {
    fetchResult = await fetchRepoMeta(owner, name)
  } catch (e) {
    console.error('[analyze] fetch failed:', e)
    return NextResponse.json(
      { error: `Failed to fetch repository: ${(e as Error).message}` },
      { status: 502 },
    )
  }
  if (fetchResult.rateLimited) {
    return NextResponse.json(
      {
        error:
          'GitHub API rate limit hit (60 req/hr unauthenticated). ' +
          'Wait ~1hr, set GITHUB_TOKEN, or try a different repo.',
      },
      { status: 429 },
    )
  }
  const meta: RepoMeta = fetchResult.meta
  if (fetchResult.missingParts.includes('repo')) {
    return NextResponse.json(
      { error: `Repository ${owner}/${name} not found (404). Is the repo public?` },
      { status: 404 },
    )
  }

  // 2. Run LLM analysis.
  let analysisResult
  try {
    analysisResult = await analyzeRepo(meta)
  } catch (e) {
    console.error('[analyze] LLM failed:', e)
    return NextResponse.json(
      { error: `LLM analysis failed: ${(e as Error).message}` },
      { status: 500 },
    )
  }
  const { analysis, sections } = analysisResult
  const readmeMarkdown = renderReadme(analysis, sections, meta)

  // 3. Persist: upsert the Repo + create a new Generation.
  let repo
  try {
    repo = await db.repo.upsert({
      where: { owner_name: { owner, name } },
      update: {
        url: meta.url,
        defaultBranch: meta.defaultBranch,
        description: meta.description ?? null,
        language: meta.language ?? null,
        stars: meta.stars ?? null,
        license: meta.license ?? null,
        lastAnalyzedAt: new Date(),
      },
      create: {
        owner,
        name,
        url: meta.url,
        defaultBranch: meta.defaultBranch,
        description: meta.description ?? null,
        language: meta.language ?? null,
        stars: meta.stars ?? null,
        license: meta.license ?? null,
        lastAnalyzedAt: new Date(),
      },
    })
  } catch (e) {
    console.error('[analyze] db upsert failed:', e)
    return NextResponse.json(
      { error: `Database error: ${(e as Error).message}. Make sure prisma db:push has been run.` },
      { status: 500 },
    )
  }

  let generation
  try {
    generation = await db.generation.create({
      data: {
        repoId: repo.id,
        analysisJson: JSON.stringify(analysis),
        readmeMarkdown,
        sectionsJson: JSON.stringify(sections),
      },
    })
  } catch (e) {
    console.error('[analyze] db insert failed:', e)
    return NextResponse.json(
      { error: `Failed to persist generation: ${(e as Error).message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({
    repo: { id: repo.id, owner: repo.owner, name: repo.name, url: repo.url },
    generation: { id: generation.id, createdAt: generation.createdAt.toISOString() },
    analysis,
    readmeMarkdown,
    sections,
    meta,
    warnings: {
      rateLimited: fetchResult.rateLimited,
      missingParts: fetchResult.missingParts,
    },
  })
}
