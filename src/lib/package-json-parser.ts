/**
 * Multi-ecosystem manifest parser.
 *
 * Supports:
 *   - npm package.json
 *   - pyproject.toml ([tool.poetry] and PEP-621 [project])
 *   - Cargo.toml ([package])
 *   - go.mod (heuristic: module + go version lines)
 *
 * Detection order:
 *   1. If `filename` is provided and recognised, parse by extension.
 *   2. Otherwise try JSON (npm) first.
 *   3. Otherwise sniff for `[tool.poetry]` / `[project]` / `[package]` / `module github.com/...`.
 *
 * Returns null when no recognised manifest is found.
 */

import type { ManifestInfo } from '@/lib/types'

export function parseManifest(content: string, filename?: string): ManifestInfo | null {
  if (!content || typeof content !== 'string') return null
  const text = content.trim()
  if (text.length === 0) return null

  const fn = (filename ?? '').toLowerCase()

  // 1. filename hint
  if (fn === 'package.json') return parseNpm(content)
  if (fn === 'pyproject.toml') return parsePyproject(content)
  if (fn === 'cargo.toml') return parseCargo(content)
  if (fn === 'go.mod') return parseGoMod(content)

  // 2. content sniffing
  if (text.startsWith('{')) {
    try {
      return parseNpm(content)
    } catch {
      // fallthrough to TOML sniffing
    }
  }
  if (text.includes('[tool.poetry]') || text.includes('[project]')) {
    return parsePyproject(content)
  }
  if (text.includes('[package]') && (text.includes('name =') || text.includes('name='))) {
    return parseCargo(content)
  }
  if (/^module\s+\S+/m.test(text) && /^go\s+\d/m.test(text)) {
    return parseGoMod(content)
  }
  return null
}

function parseNpm(content: string): ManifestInfo | null {
  let pkg: any
  try {
    pkg = JSON.parse(content)
  } catch {
    return null
  }
  if (!pkg || typeof pkg !== 'object') return null
  const name = typeof pkg.name === 'string' ? pkg.name : ''
  if (!name) return null
  return {
    ecosystem: 'npm',
    name,
    version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
    description: typeof pkg.description === 'string' ? pkg.description : undefined,
    scripts: normalizeStringMap(pkg.scripts),
    dependencies: normalizeStringMap(pkg.dependencies),
    devDependencies: normalizeStringMap(pkg.devDependencies),
    license: typeof pkg.license === 'string' ? pkg.license : licenseFromObject(pkg.license),
    raw: content,
  }
}

function licenseFromObject(lic: any): string | undefined {
  if (!lic) return undefined
  if (typeof lic === 'string') return lic
  if (Array.isArray(lic) && lic.length > 0 && typeof lic[0] === 'string') return lic[0]
  if (typeof lic === 'object' && typeof lic.type === 'string') return lic.type
  return undefined
}

function normalizeStringMap(val: any): Record<string, string> {
  if (!val || typeof val !== 'object') return {}
  const out: Record<string, string> = {}
  for (const k of Object.keys(val)) {
    const v = val[k]
    if (typeof v === 'string' || typeof v === 'number') out[k] = String(v)
  }
  return out
}

function stripQuotes(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    return t.slice(1, -1)
  }
  return t
}

/** Tiny TOML-ish line iterator. Returns key/value pairs for a given section. */
function tomlSection(content: string, header: string): Record<string, string> {
  const lines = content.split(/\r?\n/)
  const out: Record<string, string> = {}
  let inSection = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const h = trimmed.slice(1, -1).trim()
      if (h === header) {
        inSection = true
        continue
      }
      if (inSection) {
        // Any other header ends the current section, UNLESS it's a sub-table
        // (e.g. `[tool.poetry.dependencies]` is extended by
        // `[tool.poetry.dependencies.optional]` but ended by
        // `[tool.poetry.group.dev.dependencies]`).
        if (h.startsWith(header + '.')) {
          continue
        }
        inSection = false
      }
      continue
    }
    if (!inSection) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = stripQuotes(trimmed.slice(0, eq).trim())
    let val = trimmed.slice(eq + 1).trim()
    if (val.startsWith('"') || val.startsWith("'")) {
      const q = val[0]
      const end = val.indexOf(q, 1)
      if (end !== -1) val = val.slice(1, end)
      else val = val.slice(1)
    } else if (val.includes('#')) {
      val = val.split('#')[0].trim()
    }
    out[key] = val
  }
  return out
}

function parsePyproject(content: string): ManifestInfo | null {
  const project = tomlSection(content, 'project')
  const poetry = tomlSection(content, 'tool.poetry')
  const source = Object.keys(project).length >= 1 ? project : poetry
  if (Object.keys(source).length === 0) return null
  const ecosystem = source === project ? 'pep621' : 'poetry'
  const name = source.name || ''
  if (!name) return null

  const scripts = {
    ...tomlSection(content, 'project.scripts'),
    ...tomlSection(content, 'tool.poetry.scripts'),
  }

  // Dependencies — try key-value table form first (Poetry-style or non-standard
  // `[project.dependencies]` table), fall back to array form (standard PEP-621
  // `dependencies = [...]` inside `[project]`).
  const deps = {
    ...parsePyDeps(content, 'project.dependencies'),
    ...parsePyDeps(content, 'tool.poetry.dependencies'),
  }
  const devDeps = {
    ...parsePyDeps(content, 'project.optional-dependencies'),
    ...parsePyDeps(content, 'tool.poetry.group.dev.dependencies'),
  }

  return {
    ecosystem,
    name,
    version: source.version || '0.0.0',
    description: source.description || undefined,
    scripts,
    dependencies: deps,
    devDependencies: devDeps,
    license: source.license || undefined,
    raw: content,
  }
}

/** PEP-621/Poetry dependencies — detects key-value table form (Poetry) or array
 * form (standard PEP-621 `dependencies = [...]` inside `[project]`). */
function parsePyDeps(content: string, header: string): Record<string, string> {
  // First try key-value table form (Poetry-style `[tool.poetry.dependencies]`
  // or non-standard `[project.dependencies]`).
  const asTable = tomlSection(content, header)
  if (Object.keys(asTable).length > 0) return asTable
  // Else fall back to the array form: `dependencies = [...]` inside `[project]`.
  return parsePyDepsArray(content, header)
}

/** PEP-621/Poetry dependencies array section — list of "name [extras] op ver [marker]" strings. */
function parsePyDepsArray(content: string, header: string): Record<string, string> {
  const lines = content.split(/\r?\n/)
  const out: Record<string, string> = {}
  let inSection = false
  let buf = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      if (trimmed.slice(1, -1).trim() === header) {
        inSection = true
        buf = ''
        continue
      }
      if (inSection) {
        flushArrayDeps(out, buf)
        inSection = false
      }
      continue
    }
    if (!inSection) continue
    buf += '\n' + line
  }
  if (inSection) flushArrayDeps(out, buf)
  return out
}

function flushArrayDeps(out: Record<string, string>, buf: string): void {
  const flat = buf.replace(/[\[\]]/g, ' ').replace(/\n/g, ' ')
  const parts = splitTopLevelCommas(flat)
  for (let p of parts) {
    p = stripQuotes(p).trim()
    if (!p) continue
    const m = p.match(/^([A-Za-z0-9_.-]+)/)
    if (m) {
      const name = m[1].toLowerCase()
      out[name] = p
    }
  }
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  let inStr: string | null = null
  for (const ch of s) {
    if (inStr) {
      cur += ch
      if (ch === inStr) inStr = null
      continue
    }
    if (ch === '"' || ch === "'") {
      inStr = ch
      cur += ch
      continue
    }
    if (ch === '(' || ch === '[') depth++
    if (ch === ')' || ch === ']') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

function parseCargo(content: string): ManifestInfo | null {
  const pkg = tomlSection(content, 'package')
  const name = pkg.name || ''
  if (!name) return null
  const deps = tomlSection(content, 'dependencies')
  const devDeps = tomlSection(content, 'dev-dependencies')
  return {
    ecosystem: 'cargo',
    name,
    version: pkg.version || '0.0.0',
    description: pkg.description || undefined,
    scripts: {},
    dependencies: deps,
    devDependencies: devDeps,
    license: pkg.license || undefined,
    raw: content,
  }
}

function parseGoMod(content: string): ManifestInfo | null {
  const moduleMatch = content.match(/^module\s+(\S+)/m)
  if (!moduleMatch) return null
  const fullModule = moduleMatch[1]
  const name = fullModule.split('/').pop() || fullModule
  const goMatch = content.match(/^go\s+(\S+)/m)
  const version = goMatch ? goMatch[1] : '0.0.0'

  const deps: Record<string, string> = {}
  const lines = content.split(/\r?\n/)
  let inRequire = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === 'require (') {
      inRequire = true
      continue
    }
    if (inRequire && trimmed === ')') {
      inRequire = false
      continue
    }
    if (inRequire) {
      const m = trimmed.match(/^(\S+)\s+(\S+)/)
      if (m) deps[m[1]] = m[2]
    } else if (trimmed.startsWith('require ')) {
      const m = trimmed.match(/^require\s+(\S+)\s+(\S+)/)
      if (m) deps[m[1]] = m[2]
    }
  }

  return {
    ecosystem: 'go',
    name,
    version,
    description: undefined,
    scripts: {},
    dependencies: deps,
    devDependencies: {},
    license: undefined,
    raw: content,
  }
}
