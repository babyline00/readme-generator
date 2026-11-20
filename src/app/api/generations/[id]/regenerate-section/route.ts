import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { regenerateSection } from '@/lib/analyzer'
import { renderReadme } from '@/lib/readme-renderer'
import { replaceSection } from '@/lib/section-toggle'
import type { RepoAnalysis, RepoMeta, Section } from '@/lib/types'

export const runtime = 'nodejs'

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  let body: { sectionId?: string; hint?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const sectionId = body?.sectionId
  if (!sectionId || typeof sectionId !== 'string') {
    return NextResponse.json({ error: 'Missing required field: sectionId' }, { status: 400 })
  }

  try {
    const gen = await db.generation.findUnique({ where: { id }, include: { repo: true } })
    if (!gen) {
      return NextResponse.json({ error: 'Generation not found' }, { status: 404 })
    }

    let analysis: RepoAnalysis
    try {
      analysis = JSON.parse(gen.analysisJson) as RepoAnalysis
    } catch {
      return NextResponse.json({ error: 'Corrupt analysisJson on generation' }, { status: 500 })
    }

    let sections: Section[]
    try {
      sections = JSON.parse(gen.sectionsJson) as Section[]
    } catch {
      sections = []
    }

    const section = sections.find((s) => s.id === sectionId)
    if (!section) {
      return NextResponse.json({ error: `Section ${sectionId} not found` }, { status: 404 })
    }

    const meta: RepoMeta = {
      owner: gen.repo.owner,
      name: gen.repo.name,
      url: gen.repo.url,
      defaultBranch: gen.repo.defaultBranch || 'main',
      description: gen.repo.description || undefined,
      language: gen.repo.language || undefined,
      stars: gen.repo.stars ?? undefined,
      license: gen.repo.license || undefined,
      tree: [],
      manifest: null,
      sourceFiles: [],
      commits: [],
    }

    const newContent = await regenerateSection(sectionId, analysis, meta, body.hint)
    const updatedSection: Section = { ...section, content: newContent }
    const nextSections = replaceSection(sections, updatedSection)
    const readmeMarkdown = renderReadme(analysis, nextSections, meta)

    await db.generation.update({
      where: { id },
      data: {
        sectionsJson: JSON.stringify(nextSections),
        readmeMarkdown,
      },
    })

    return NextResponse.json({ section: updatedSection, readmeMarkdown })
  } catch (e) {
    console.error('[regenerate-section] failed:', e)
    return NextResponse.json(
      { error: `Failed to regenerate section: ${(e as Error).message}` },
      { status: 500 },
    )
  }
}
