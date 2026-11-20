import { test, expect, describe } from 'bun:test'
import { renderReadme, defaultSections, renderBadges } from '../readme-renderer'
import type { RepoAnalysis, RepoMeta, Section } from '@/lib/types'

function baseAnalysis(): RepoAnalysis {
  return {
    tagline: 'A short tagline',
    description: 'This project does X.',
    features: ['Feature one', 'Feature two'],
    techStack: [
      { name: 'Next.js', role: 'Framework' },
      { name: 'TypeScript', role: 'Language' },
    ],
    gettingStarted: {
      install: ['npm install'],
      run: ['npm run dev'],
    },
    commitThemes: [],
    license: 'MIT',
  }
}

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
    tree: [
      { path: 'src', type: 'tree' },
      { path: 'README.md', type: 'blob', size: 1000 },
      { path: 'package.json', type: 'blob', size: 200 },
      { path: 'src/index.ts', type: 'blob', size: 500 },
      { path: 'src/utils.ts', type: 'blob', size: 300 },
      { path: 'src/components/Button.tsx', type: 'blob', size: 800 },
    ],
    manifest: null,
    sourceFiles: [],
    commits: [
      { sha: 'abc1234567', message: 'feat: add button', author: 'dev', date: '2024-01-01T00:00:00Z' },
      { sha: 'def8901234', message: 'fix: rendering bug', author: 'dev2', date: '2024-01-02T00:00:00Z' },
    ],
  }
}

describe('renderReadme — basic shape', () => {
  test('emits title + tagline at top', () => {
    const sections = defaultSections(baseAnalysis(), baseMeta())
    const md = renderReadme(baseAnalysis(), sections, baseMeta())
    expect(md.startsWith('# widget')).toBe(true)
    expect(md).toContain('> A short tagline')
  })
  test('emits badges block with shields.io URLs', () => {
    const sections = defaultSections(baseAnalysis(), baseMeta())
    const md = renderReadme(baseAnalysis(), sections, baseMeta())
    expect(md).toContain('img.shields.io')
    expect(md).toContain('MIT')
  })
  test('contains all default section headings', () => {
    const sections = defaultSections(baseAnalysis(), baseMeta())
    const md = renderReadme(baseAnalysis(), sections, baseMeta())
    expect(md).toContain('## Description')
    expect(md).toContain('## Features')
    expect(md).toContain('## Tech Stack')
    expect(md).toContain('## Getting Started')
    expect(md).toContain('## Project Structure')
    expect(md).toContain('## Recent Commits')
    expect(md).toContain('## Contributing')
    expect(md).toContain('## License')
  })
})

describe('renderReadme — toggling + reordering', () => {
  test('omits disabled sections', () => {
    const sections = defaultSections(baseAnalysis(), baseMeta())
    const disabled = sections.map((s) => (s.id === 'features' ? { ...s, enabled: false } : s))
    const md = renderReadme(baseAnalysis(), disabled, baseMeta())
    expect(md).not.toContain('## Features')
    // Other sections still present
    expect(md).toContain('## Description')
  })
  test('reflects reordered sections', () => {
    const sections = defaultSections(baseAnalysis(), baseMeta())
    // Move License to the front (index 0).
    const reordered = [...sections]
    const license = reordered.find((s) => s.id === 'license')!
    const without = reordered.filter((s) => s.id !== 'license')
    const newOrder: Section[] = [license, ...without]
    const md = renderReadme(baseAnalysis(), newOrder, baseMeta())
    const licenseIdx = md.indexOf('## License')
    const descIdx = md.indexOf('## Description')
    expect(licenseIdx).toBeLessThan(descIdx)
    expect(licenseIdx).toBeGreaterThan(-1)
  })
  test('uses the user-edited section content verbatim', () => {
    const sections: Section[] = [
      { id: 'description', label: 'Description', enabled: true, content: 'My custom description body.' },
    ]
    const md = renderReadme(baseAnalysis(), sections, baseMeta())
    expect(md).toContain('## Description')
    expect(md).toContain('My custom description body.')
  })
})

describe('renderReadme — ASCII tree + commits', () => {
  test('renders an ASCII tree from meta.tree', () => {
    const sections = defaultSections(baseAnalysis(), baseMeta())
    const md = renderReadme(baseAnalysis(), sections, baseMeta())
    expect(md).toContain('```text')
    expect(md).toContain('src/')
    expect(md).toContain('package.json')
  })
  test('renders recent commits table with first 10', () => {
    const meta = baseMeta()
    meta.commits = Array.from({ length: 15 }, (_, i) => ({
      sha: `sha${i}`.padEnd(7, '0'),
      message: `commit ${i}`,
      author: 'dev',
      date: `2024-01-${(i + 1).toString().padStart(2, '0')}T00:00:00Z`,
    }))
    const sections = defaultSections(baseAnalysis(), meta)
    const md = renderReadme(baseAnalysis(), sections, meta)
    // The table should have a header row + 10 data rows = 11 lines under the section.
    const sectionStart = md.indexOf('## Recent Commits')
    const sectionEnd = md.indexOf('## Contributing')
    const section = md.slice(sectionStart, sectionEnd)
    const tableRows = section.split('\n').filter((l) => l.startsWith('| `'))
    expect(tableRows).toHaveLength(10)
  })
  test('renderBadges includes stars + license + language', () => {
    const badges = renderBadges(baseAnalysis(), baseMeta())
    expect(badges).toContain('license')
    expect(badges).toContain('language')
    expect(badges).toContain('stars')
    expect(badges).toContain('42')
  })
})

describe('renderReadme — empty / degraded inputs', () => {
  test('works without meta (no tree, no commits)', () => {
    const sections = defaultSections(baseAnalysis())
    const md = renderReadme(baseAnalysis(), sections, undefined)
    expect(md).toContain('## Description')
    expect(md).toContain('## Project Structure')
    // Should not crash and should produce a non-trivial README.
    expect(md.length).toBeGreaterThan(200)
  })
  test('works with no enabled sections', () => {
    const md = renderReadme(baseAnalysis(), [], baseMeta())
    // Should still emit the title + tagline + badges.
    expect(md).toContain('# widget')
    expect(md).toContain('img.shields.io')
  })
})
