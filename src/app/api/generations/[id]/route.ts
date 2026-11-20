import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { renderReadme } from '@/lib/readme-renderer'
import type { RepoAnalysis, RepoMeta, Section } from '@/lib/types'

export const runtime = 'nodejs'

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const gen = await db.generation.findUnique({
      where: { id },
      include: {
        repo: true,
      },
    })
    if (!gen) {
      return NextResponse.json({ error: 'Generation not found' }, { status: 404 })
    }
    return NextResponse.json({
      id: gen.id,
      repoId: gen.repoId,
      analysisJson: gen.analysisJson,
      readmeMarkdown: gen.readmeMarkdown,
      sectionsJson: gen.sectionsJson,
      createdAt: gen.createdAt.toISOString(),
      repo: {
        id: gen.repo.id,
        owner: gen.repo.owner,
        name: gen.repo.name,
        url: gen.repo.url,
        defaultBranch: gen.repo.defaultBranch,
        description: gen.repo.description,
        language: gen.repo.language,
        stars: gen.repo.stars,
        license: gen.repo.license,
      },
    })
  } catch (e) {
    console.error('[generations/:id] GET failed:', e)
    return NextResponse.json(
      { error: `Failed to load generation: ${(e as Error).message}` },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  let body: { sections?: Section[]; readmeMarkdown?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!Array.isArray(body.sections)) {
    return NextResponse.json({ error: 'Missing required field: sections (array)' }, { status: 400 })
  }

  try {
    const existing = await db.generation.findUnique({ where: { id }, include: { repo: true } })
    if (!existing) {
      return NextResponse.json({ error: 'Generation not found' }, { status: 404 })
    }

    // Re-derive the README markdown so it's always consistent with sections.
    let analysis: RepoAnalysis | null = null
    try {
      analysis = JSON.parse(existing.analysisJson) as RepoAnalysis
    } catch {
      analysis = null
    }
    const meta: RepoMeta = {
      owner: existing.repo.owner,
      name: existing.repo.name,
      url: existing.repo.url,
      defaultBranch: existing.repo.defaultBranch || 'main',
      description: existing.repo.description || undefined,
      language: existing.repo.language || undefined,
      stars: existing.repo.stars ?? undefined,
      license: existing.repo.license || undefined,
      tree: [],
      manifest: null,
      sourceFiles: [],
      commits: [],
    }
    const readmeMarkdown =
      typeof body.readmeMarkdown === 'string' && body.readmeMarkdown.length > 0
        ? body.readmeMarkdown
        : analysis
          ? renderReadme(analysis, body.sections, meta)
          : ''

    const updated = await db.generation.update({
      where: { id },
      data: {
        sectionsJson: JSON.stringify(body.sections),
        readmeMarkdown,
      },
    })

    return NextResponse.json({
      id: updated.id,
      updatedAt: updated.createdAt.toISOString(),
      readmeMarkdown,
    })
  } catch (e) {
    console.error('[generations/:id] PATCH failed:', e)
    return NextResponse.json(
      { error: `Failed to update generation: ${(e as Error).message}` },
      { status: 500 },
    )
  }
}
