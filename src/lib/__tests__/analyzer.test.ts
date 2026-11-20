import { test, expect, describe } from 'bun:test'
import { analyzeRepo, buildPrompt, safeParseAnalysis, fallbackAnalysis, buildSectionPrompt } from '../analyzer'
import type { ChatProvider } from '@/lib/ai'
import type { RepoMeta, RepoAnalysis } from '@/lib/types'

function baseMeta(): RepoMeta {
  return {
    owner: 'acme',
    name: 'widget',
    url: 'https://github.com/acme/widget',
    defaultBranch: 'main',
    description: 'A widget library',
    language: 'TypeScript',
    stars: 42,
    license: 'MIT',
    tree: [],
    manifest: {
      ecosystem: 'npm',
      name: 'widget',
      version: '1.0.0',
      description: 'A widget library for React',
      scripts: { dev: 'next dev', build: 'next build' },
      dependencies: { next: '^16', react: '^19' },
      devDependencies: { typescript: '^5' },
      license: 'MIT',
      raw: '{}',
    },
    sourceFiles: [],
    commits: [
      { sha: 'aaa', message: 'feat: add database connection pooling', author: 'dev', date: '2024-01-01' },
      { sha: 'bbb', message: 'fix: database timeout on heavy queries', author: 'dev2', date: '2024-01-02' },
      { sha: 'ccc', message: 'feat: database migrations runner', author: 'dev', date: '2024-01-03' },
    ],
  }
}

class MockLLM implements ChatProvider {
  constructor(private responses: string[]) {}
  idx = 0
  async complete(): Promise<string> {
    return this.responses[this.idx++ % this.responses.length]
  }
}

class JsonLLM implements ChatProvider {
  constructor(private obj: any) {}
  async complete(): Promise<string> {
    return JSON.stringify(this.obj)
  }
}

class FailingLLM implements ChatProvider {
  async complete(): Promise<string> {
    throw new Error('boom')
  }
}

describe('buildPrompt', () => {
  test('includes repo name', () => {
    const p = buildPrompt(baseMeta())
    expect(p).toContain('acme/widget')
  })
  test('includes manifest name and description', () => {
    const p = buildPrompt(baseMeta())
    expect(p).toContain('widget')
    expect(p).toContain('A widget library for React')
  })
  test('includes tech-stack-relevant deps', () => {
    const p = buildPrompt(baseMeta())
    expect(p).toContain('next')
    expect(p).toContain('react')
    expect(p.toLowerCase()).toContain('typescript')
  })
  test('includes commit summaries', () => {
    const p = buildPrompt(baseMeta())
    // The "database" keyword appears in 3 of 3 commits.
    expect(p).toContain('database')
  })
})

describe('analyzeRepo — happy path', () => {
  test('returns analysis + sections + raw', async () => {
    const mock = new JsonLLM({
      tagline: 'A widget library',
      description: 'Widget library for React apps.',
      features: ['Feature 1', 'Feature 2', 'Feature 3', 'Feature 4', 'Feature 5'],
      techStack: [{ name: 'Next.js', role: 'Framework' }],
      gettingStarted: { install: ['npm install'], run: ['npm run dev'] },
      license: 'MIT',
    })
    const result = await analyzeRepo(baseMeta(), { provider: mock })
    expect(result.analysis.tagline).toBe('A widget library')
    expect(result.analysis.features.length).toBeGreaterThanOrEqual(5)
    expect(result.sections.length).toBeGreaterThanOrEqual(5)
    expect(result.raw).toContain('A widget library')
  })
  test('populates commitThemes from summarizeCommits (not LLM)', async () => {
    const mock = new JsonLLM({
      tagline: 'x',
      description: 'y',
      features: [],
      techStack: [],
      gettingStarted: {},
      license: 'MIT',
    })
    const result = await analyzeRepo(baseMeta(), { provider: mock })
    expect(result.analysis.commitThemes.length).toBeGreaterThan(0)
    expect(result.analysis.commitThemes[0].keyword).toBe('database')
  })
})

describe('analyzeRepo — LLM failure fallback', () => {
  test('falls back to fallbackAnalysis when LLM throws', async () => {
    const result = await analyzeRepo(baseMeta(), { provider: new FailingLLM() })
    expect(result.analysis.tagline.length).toBeGreaterThan(0)
    expect(result.analysis.features.length).toBeGreaterThan(0)
    expect(result.sections.length).toBeGreaterThan(0)
  })
})

describe('safeParseAnalysis', () => {
  test('parses clean JSON', () => {
    const a = safeParseAnalysis(JSON.stringify({
      tagline: 'x', description: 'y', features: ['f'], techStack: [], gettingStarted: {}, license: 'MIT',
    }))
    expect(a).not.toBeNull()
    expect(a!.tagline).toBe('x')
  })
  test('strips markdown fences', () => {
    const a = safeParseAnalysis('```json\n' + JSON.stringify({
      tagline: 'x', description: 'y', features: ['f'], techStack: [], gettingStarted: {}, license: 'MIT',
    }) + '\n```')
    expect(a).not.toBeNull()
    expect(a!.tagline).toBe('x')
  })
  test('returns null for non-JSON', () => {
    expect(safeParseAnalysis('just prose, no json')).toBeNull()
  })
  test('returns null for empty input', () => {
    expect(safeParseAnalysis('')).toBeNull()
  })
})

describe('fallbackAnalysis', () => {
  test('returns a sensible default analysis', () => {
    const a = fallbackAnalysis(baseMeta())
    expect(a.license).toBe('MIT')
    expect(a.tagline.length).toBeGreaterThan(0)
    expect(a.features.length).toBeGreaterThan(0)
  })
})

describe('buildSectionPrompt', () => {
  test('includes the section label and repo name', () => {
    const p = buildSectionPrompt('features', fallbackAnalysis(baseMeta()), baseMeta(), undefined)
    expect(p.toLowerCase()).toContain('features')
    expect(p).toContain('acme/widget')
  })
  test('includes the user hint when provided', () => {
    const p = buildSectionPrompt('description', fallbackAnalysis(baseMeta()), baseMeta(), 'make it shorter')
    expect(p).toContain('make it shorter')
  })
})
