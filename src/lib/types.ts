/**
 * Shared domain types for README Generator Copilot.
 * Kept framework-agnostic so they can be used by both API routes and unit tests.
 */

/** A single file entry in a GitHub repo tree. */
export interface TreeEntry {
  path: string
  type: 'blob' | 'tree'
  size?: number
}

/** A small source file fetched for LLM context. */
export interface SourceFile {
  path: string
  language: string
  content: string
  size: number
}

/** A recent commit on the default branch. */
export interface CommitEntry {
  sha: string
  message: string
  author: string
  date: string
}

/** A normalized manifest regardless of ecosystem (npm/Poetry/PEP621/Cargo/Go). */
export interface ManifestInfo {
  /** Ecosystem identifier — 'npm', 'poetry', 'pep621', 'cargo', 'go', 'unknown'. */
  ecosystem: 'npm' | 'poetry' | 'pep621' | 'cargo' | 'go' | 'unknown'
  name: string
  version: string
  description?: string
  /** Map of script/target -> command (npm scripts, poetry scripts, make targets, etc.). */
  scripts: Record<string, string>
  /** Map of dependency name -> version spec. */
  dependencies: Record<string, string>
  /** Map of dev/optional dependency name -> version spec. */
  devDependencies: Record<string, string>
  license?: string
  /** Raw manifest text — kept so the renderer can quote exact commands. */
  raw: string
}

/** Everything the GitHub fetcher returns for a single repo. */
export interface RepoMeta {
  owner: string
  name: string
  url: string
  defaultBranch: string
  description?: string
  language?: string
  stars?: number
  license?: string
  tree: TreeEntry[]
  /** null when no recognized manifest was found. */
  manifest: ManifestInfo | null
  sourceFiles: SourceFile[]
  commits: CommitEntry[]
}

/** A theme discovered by the commit summarizer. */
export interface CommitTheme {
  keyword: string
  count: number
  exampleSha: string
}

/** Structured analysis produced by the LLM. Persisted as analysisJson. */
export interface RepoAnalysis {
  /** Project tagline — single sentence. */
  tagline: string
  /** Longer description — 1–2 paragraphs. */
  description: string
  /** 5–10 short feature bullets. */
  features: string[]
  /** Tech stack as a list of { name, role } rows. */
  techStack: { name: string; role: string }[]
  /** Getting started steps (install + run commands derived from manifest). */
  gettingStarted: { install: string[]; run: string[]; notes?: string }
  /** Commit themes — top 3 keywords from recent commits. */
  commitThemes: CommitTheme[]
  /** License — defaults to 'MIT' if unknown. */
  license: string
}

/** A single README section that the user can toggle, reorder, or edit. */
export interface Section {
  /** Stable id — used by section-toggle pure functions. */
  id: string
  /** Display label + heading shown in the rendered README. */
  label: string
  /** Whether the section appears in the rendered README. */
  enabled: boolean
  /** The Markdown body of the section (without the leading `#` heading). */
  content: string
}

/** Full README generation record — what we persist in Generation.sectionsJson. */
export interface SectionsState {
  sections: Section[]
}

/** Result shape returned by POST /api/repos/analyze. */
export interface AnalyzeResult {
  repo: {
    id: string
    owner: string
    name: string
    url: string
  }
  generation: {
    id: string
    createdAt: string
  }
  analysis: RepoAnalysis
  readmeMarkdown: string
  sections: Section[]
}
