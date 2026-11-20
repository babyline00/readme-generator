/**
 * Repo analyzer — runs a single LLM completion that turns a RepoMeta into a
 * structured RepoAnalysis JSON. Used by POST /api/repos/analyze and by
 * POST /api/generations/[id]/regenerate-section (the latter only re-runs a
 * per-section prompt).
 *
 * The analyzer builds a deterministic prompt from the fetched repo (name,
 * description, manifest info, top source files, recent commits) and asks the
 * LLM to return strict JSON. We then validate the JSON shape and fall back to
 * a sensible default for any missing field so the renderer always has
 * something to work with.
 */

import { getChatProvider, type ChatProvider } from '@/lib/ai'
import type {
  CommitEntry,
  CommitTheme,
  RepoAnalysis,
  RepoMeta,
  Section,
} from '@/lib/types'
import { summarizeCommits } from '@/lib/commit-summarizer'
import { defaultSections } from '@/lib/readme-renderer'

const SYSTEM_PROMPT =
  'You are README Generator Copilot — an AI that reads a GitHub repository\'s ' +
  'metadata, manifest, top source files, and recent commits, and produces a ' +
  'structured JSON analysis that a separate renderer will turn into a README.md. ' +
  'Rules:\n' +
  '1. Respond with a single JSON object and NOTHING else — no markdown fences, no prose.\n' +
  '2. The object MUST contain these fields: tagline (string), description (string, 1-2 paragraphs), ' +
  'features (5-10 short bullet strings), techStack (array of {name, role}), ' +
  'gettingStarted ({install: string[], run: string[], notes?: string}), license (string).\n' +
  '3. Do not invent dependencies or features that are not implied by the manifest, source files, or commits.\n' +
  '4. Keep bullets short (<= 12 words). Keep tagline <= 16 words.\n' +
  '5. Use plain ASCII (no emojis) in every field.'

export interface AnalyzeResult {
  analysis: RepoAnalysis
  sections: Section[]
  /** Raw LLM output for debugging / persistence. */
  raw: string
}

export async function analyzeRepo(meta: RepoMeta, opts: { provider?: ChatProvider } = {}): Promise<AnalyzeResult> {
  const provider = opts.provider ?? getChatProvider()
  const prompt = buildPrompt(meta)
  let raw = ''
  try {
    raw = await provider.complete({
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (e) {
    console.warn('[analyzer] LLM call failed, using fallback:', (e as Error).message)
    raw = ''
  }

  const parsed = safeParseAnalysis(raw)
  const analysis = parsed || fallbackAnalysis(meta)
  // Always overwrite commitThemes — they're computed deterministically from
  // the commits and the LLM shouldn't get to invent them.
  analysis.commitThemes = summarizeCommits(meta.commits, { topK: 3 })

  const sections = defaultSections(analysis, meta)
  return { analysis, sections, raw }
}

/** Build the user-side prompt — exported so tests can assert it contains the
 *  manifest name, description, and a commit summary. */
export function buildPrompt(meta: RepoMeta): string {
  const lines: string[] = []
  lines.push(`Repository: ${meta.owner}/${meta.name}`)
  lines.push(`Default branch: ${meta.defaultBranch}`)
  if (meta.description) lines.push(`Description from GitHub: ${meta.description}`)
  if (meta.language) lines.push(`Primary language: ${meta.language}`)
  if (meta.license) lines.push(`License (SPDX): ${meta.license}`)
  if (meta.stars !== undefined) lines.push(`Stars: ${meta.stars}`)
  lines.push('')

  if (meta.manifest) {
    const m = meta.manifest
    lines.push(`Manifest (ecosystem=${m.ecosystem}):`)
    lines.push(`  name: ${m.name}`)
    lines.push(`  version: ${m.version}`)
    if (m.description) lines.push(`  description: ${m.description}`)
    if (m.license) lines.push(`  license: ${m.license}`)
    const depCount = Object.keys(m.dependencies).length
    const devDepCount = Object.keys(m.devDependencies).length
    lines.push(`  dependencies: ${depCount}`)
    lines.push(`  devDependencies: ${devDepCount}`)
    // Surface the top dependency names so the LLM can reason about tech stack.
    const topDeps = Object.keys(m.dependencies).slice(0, 12)
    if (topDeps.length > 0) lines.push(`  topDependencies: ${topDeps.join(', ')}`)
    const scripts = Object.entries(m.scripts)
    if (scripts.length > 0) {
      lines.push('  scripts:')
      for (const [k, v] of scripts.slice(0, 10)) {
        lines.push(`    ${k} = ${v}`)
      }
    }
    lines.push('')
  } else {
    lines.push('Manifest: none detected (no package.json/pyproject.toml/Cargo.toml/go.mod in the tree root).')
    lines.push('')
  }

  if (meta.sourceFiles.length > 0) {
    lines.push('Top source files (smallest 5):')
    for (const f of meta.sourceFiles) {
      lines.push(`  ${f.path} (${f.language}, ${f.size} bytes)`)
    }
    lines.push('')
  }

  if (meta.commits.length > 0) {
    lines.push(`Recent commits (last ${meta.commits.length}):`)
    for (const c of meta.commits.slice(0, 30) as CommitEntry[]) {
      const first = (c.message || '').split('\n')[0].slice(0, 100)
      lines.push(`  ${c.sha.slice(0, 7)} ${first}`)
    }
    lines.push('')
  }

  const themes = summarizeCommits(meta.commits, { topK: 3 }) as CommitTheme[]
  if (themes.length > 0) {
    lines.push('Detected commit themes (keywords):')
    for (const t of themes) {
      lines.push(`  ${t.keyword} (${t.count} commits)`)
    }
    lines.push('')
  }

  lines.push(
    'Now produce the JSON analysis. Remember: strict JSON, no prose, no markdown fences, ' +
      'all five required top-level fields.',
  )
  return lines.join('\n')
}

/** Defensive JSON parser that strips code fences and trailing prose. */
export function safeParseAnalysis(raw: string): RepoAnalysis | null {
  if (!raw) return null
  let text = raw.trim()
  // Strip leading "```" / "```json" and trailing "```".
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim()
  }
  // Find the first balanced `{...}` block — ignore any prose after.
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  const jsonText = text.slice(start, end + 1)
  let obj: any
  try {
    obj = JSON.parse(jsonText)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  return normalizeAnalysis(obj)
}

function normalizeAnalysis(obj: any): RepoAnalysis {
  const tagline = strOr(obj.tagline, '')
  const description = strOr(obj.description, '')
  const features = arrOfStrings(obj.features, 0, 10)
  const techStack = arrOfTech(obj.techStack)
  const gettingStarted = {
    install: arrOfStrings(obj?.gettingStarted?.install, 0, 12),
    run: arrOfStrings(obj?.gettingStarted?.run, 0, 12),
    notes: obj?.gettingStarted?.notes ? strOr(obj.gettingStarted.notes, '') : undefined,
  }
  const license = strOr(obj.license, 'MIT')
  return {
    tagline,
    description,
    features,
    techStack,
    gettingStarted,
    commitThemes: [], // populated by the caller from summarizeCommits
    license,
  }
}

function strOr(v: any, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function arrOfStrings(v: any, min: number, max: number): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x) => typeof x === 'string')
    .map((x) => x as string)
    .slice(0, max)
}

function arrOfTech(v: any): { name: string; role: string }[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({ name: strOr(x.name, ''), role: strOr(x.role, '') }))
    .filter((x) => x.name || x.role)
    .slice(0, 12)
}

export function fallbackAnalysis(meta: RepoMeta): RepoAnalysis {
  const m = meta.manifest
  return {
    tagline: m?.description || meta.description || `${meta.owner}/${meta.name}`,
    description:
      (m?.description || meta.description || `${meta.name} is a project on GitHub.`) +
      (meta.language ? ` It is primarily written in ${meta.language}.` : ''),
    features: defaultFeatures(m?.ecosystem, meta.language),
    techStack: defaultTechStack(m, meta.language),
    gettingStarted: {
      install: [],
      run: [],
      notes: undefined,
    },
    commitThemes: [],
    license: m?.license || meta.license || 'MIT',
  }
}

function defaultFeatures(ecosystem?: string, language?: string): string[] {
  const feats: string[] = []
  if (ecosystem === 'npm') feats.push('Next.js / Node.js based tooling')
  if (ecosystem === 'cargo') feats.push('Rust-based, fast and memory-safe')
  if (ecosystem === 'go') feats.push('Single static binary, easy deployment')
  if (ecosystem === 'poetry' || ecosystem === 'pep621') feats.push('Python project with reproducible deps')
  if (language) feats.push(`Primary language: ${language}`)
  if (feats.length < 5) feats.push('Open source', 'MIT licensed', 'Lightweight, easy to extend')
  return feats.slice(0, 10)
}

function defaultTechStack(m: RepoMeta['manifest'], language?: string): { name: string; role: string }[] {
  const stack: { name: string; role: string }[] = []
  if (m?.ecosystem === 'npm') {
    stack.push({ name: 'Node.js', role: 'Runtime' })
    stack.push({ name: 'TypeScript', role: 'Language' })
  } else if (m?.ecosystem === 'cargo') {
    stack.push({ name: 'Rust', role: 'Language + Runtime' })
  } else if (m?.ecosystem === 'go') {
    stack.push({ name: 'Go', role: 'Language + Runtime' })
  } else if (m?.ecosystem === 'poetry' || m?.ecosystem === 'pep621') {
    stack.push({ name: 'Python', role: 'Language + Runtime' })
  } else if (language) {
    stack.push({ name: language, role: 'Primary language' })
  }
  // Add the top 4 declared dependencies as best-effort tech stack entries.
  if (m) {
    const deps = Object.keys(m.dependencies).slice(0, 4)
    for (const d of deps) stack.push({ name: d, role: 'Dependency' })
  }
  return stack
}

/** Per-section regeneration prompt — used by POST /api/generations/[id]/regenerate-section. */
export function buildSectionPrompt(sectionId: string, analysis: RepoAnalysis, meta: RepoMeta, hint?: string): string {
  const label =
    {
      description: 'Description',
      features: 'Features',
      'tech-stack': 'Tech Stack',
      'getting-started': 'Getting Started',
      structure: 'Project Structure',
      'recent-commits': 'Recent Commits',
      contributing: 'Contributing',
      license: 'License',
    }[sectionId] || 'Section'
  const lines: string[] = []
  lines.push(`Regenerate ONLY the "${label}" section of a README for ${meta.owner}/${meta.name}.`)
  if (meta.description) lines.push(`Repo description: ${meta.description}`)
  if (meta.manifest) {
    lines.push(`Manifest: ${meta.manifest.ecosystem}, ${meta.manifest.name}@${meta.manifest.version}`)
    if (meta.manifest.description) lines.push(`Manifest description: ${meta.manifest.description}`)
    const depCount = Object.keys(meta.manifest.dependencies).length
    if (depCount > 0) lines.push(`Dependencies declared: ${depCount}`)
  }
  if (hint) lines.push(`User hint: ${hint}`)
  lines.push(
    'Return only the section body as plain markdown — no leading `##` heading, no code fences around the whole response. ' +
      'Keep it under 200 words.',
  )
  return lines.join('\n')
}

export async function regenerateSection(
  sectionId: string,
  analysis: RepoAnalysis,
  meta: RepoMeta,
  hint?: string,
  opts: { provider?: ChatProvider } = {},
): Promise<string> {
  const provider = opts.provider ?? getChatProvider()
  const prompt = buildSectionPrompt(sectionId, analysis, meta, hint)
  let raw = ''
  try {
    raw = await provider.complete({
      systemPrompt: 'You are README Generator Copilot. Output ONLY the requested README section body in markdown.',
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (e) {
    console.warn('[analyzer] section regeneration failed:', (e as Error).message)
    raw = ''
  }
  return raw.trim() || '(LLM unavailable — please edit this section manually.)'
}
