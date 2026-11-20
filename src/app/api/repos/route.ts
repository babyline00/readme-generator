import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const repos = await db.repo.findMany({
      orderBy: { lastAnalyzedAt: 'desc' },
      select: {
        id: true,
        owner: true,
        name: true,
        url: true,
        description: true,
        language: true,
        stars: true,
        lastAnalyzedAt: true,
      },
    })
    return NextResponse.json(repos)
  } catch (e) {
    console.error('[repos] list failed:', e)
    return NextResponse.json(
      { error: `Failed to list repos: ${(e as Error).message}` },
      { status: 500 },
    )
  }
}
