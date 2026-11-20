import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const [repos, generations] = await Promise.all([
      db.repo.count(),
      db.generation.count(),
    ])
    return NextResponse.json({ repos, generations })
  } catch (e) {
    console.error('[stats] failed:', e)
    return NextResponse.json(
      { error: `Failed to load stats: ${(e as Error).message}` },
      { status: 500 },
    )
  }
}
