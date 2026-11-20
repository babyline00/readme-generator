import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const repo = await db.repo.findUnique({
      where: { id },
      include: {
        generations: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, createdAt: true },
        },
      },
    })
    if (!repo) {
      return NextResponse.json({ error: 'Repo not found' }, { status: 404 })
    }
    return NextResponse.json(repo)
  } catch (e) {
    console.error('[repos/:id] GET failed:', e)
    return NextResponse.json(
      { error: `Failed to load repo: ${(e as Error).message}` },
      { status: 500 },
    )
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const existing = await db.repo.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Repo not found' }, { status: 404 })
    }
    // Cascade delete in schema — generations are deleted automatically.
    await db.repo.delete({ where: { id } })
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    console.error('[repos/:id] DELETE failed:', e)
    return NextResponse.json(
      { error: `Failed to delete repo: ${(e as Error).message}` },
      { status: 500 },
    )
  }
}
