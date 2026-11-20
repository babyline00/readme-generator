'use client'

import * as React from 'react'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import ReactMarkdown from 'react-markdown'
import {
  GitBranch,
  Loader2,
  Trash2,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Copy,
  Download,
  Star,
  ExternalLink,
  Github,
  FileCode,
  Save,
} from 'lucide-react'
import { useEditorStore } from '@/lib/store'
import type { RepoAnalysis, RepoMeta, Section } from '@/lib/types'
import { renderReadme } from '@/lib/readme-renderer'

interface RepoListItem {
  id: string
  owner: string
  name: string
  url: string
  description: string | null
  language: string | null
  stars: number | null
  lastAnalyzedAt: string | null
}

interface GenerationListItem {
  id: string
  createdAt: string
}

interface RepoDetail {
  id: string
  owner: string
  name: string
  url: string
  defaultBranch: string | null
  description: string | null
  language: string | null
  stars: number | null
  license: string | null
  generations: GenerationListItem[]
}

interface GenerationDetail {
  id: string
  repoId: string
  analysisJson: string
  readmeMarkdown: string
  sectionsJson: string
  createdAt: string
  repo: {
    id: string
    owner: string
    name: string
    url: string
    defaultBranch: string | null
    description: string | null
    language: string | null
    stars: number | null
    license: string | null
  }
}

interface AnalyzeResponse {
  repo: { id: string; owner: string; name: string; url: string }
  generation: { id: string; createdAt: string }
  analysis: RepoAnalysis
  readmeMarkdown: string
  sections: Section[]
  meta: RepoMeta
}

interface StatsResponse {
  repos: number
  generations: number
}

export default function Page() {
  const { toast } = useToast()
  const editor = useEditorStore()

  const [repos, setRepos] = React.useState<RepoListItem[]>([])
  const [stats, setStats] = React.useState<StatsResponse>({ repos: 0, generations: 0 })
  const [selectedRepoId, setSelectedRepoId] = React.useState<string | null>(null)
  const [url, setUrl] = React.useState('')
  const [analyzing, setAnalyzing] = React.useState(false)
  const [loadingRepos, setLoadingRepos] = React.useState(true)

  const refreshRepos = React.useCallback(async () => {
    setLoadingRepos(true)
    try {
      const res = await fetch('/api/repos')
      if (res.ok) {
        const data = await res.json() as RepoListItem[]
        setRepos(data)
      }
    } catch (e) {
      console.warn('Failed to load repos', e)
    } finally {
      setLoadingRepos(false)
    }
  }, [])

  const refreshStats = React.useCallback(async () => {
    try {
      const res = await fetch('/api/stats')
      if (res.ok) setStats(await res.json() as StatsResponse)
    } catch (e) {
      console.warn('Failed to load stats', e)
    }
  }, [])

  React.useEffect(() => {
    refreshRepos()
    refreshStats()
  }, [refreshRepos, refreshStats])

  // Analyze a new repo.
  const handleAnalyze = async () => {
    if (!url.trim()) {
      toast({ title: 'Paste a GitHub URL first', variant: 'destructive' })
      return
    }
    setAnalyzing(true)
    try {
      const res = await fetch('/api/repos/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Request failed (${res.status})`)
      }
      const data = (await res.json()) as AnalyzeResponse
      editor.load({
        generationId: data.generation.id,
        repoId: data.repo.id,
        repo: data.repo,
        meta: data.meta,
        analysis: data.analysis,
        sections: data.sections,
      })
      setSelectedRepoId(data.repo.id)
      setUrl('')
      toast({ title: 'README generated', description: `${data.repo.owner}/${data.repo.name}` })
      refreshRepos()
      refreshStats()
    } catch (e) {
      toast({ title: 'Analyze failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setAnalyzing(false)
    }
  }

  // Select a repo from the list — fetch its detail and load the latest generation.
  const handleSelectRepo = async (repoId: string) => {
    setSelectedRepoId(repoId)
    try {
      const res = await fetch(`/api/repos/${repoId}`)
      if (!res.ok) throw new Error('Failed to load repo')
      const detail = (await res.json()) as RepoDetail
      if (!detail.generations.length) {
        toast({ title: 'No generations yet', description: 'Re-analyze the repo to create one.' })
        return
      }
      const latestGen = detail.generations[0]
      const genRes = await fetch(`/api/generations/${latestGen.id}`)
      if (!genRes.ok) throw new Error('Failed to load generation')
      const gen = (await genRes.json()) as GenerationDetail
      loadGenerationIntoEditor(gen)
    } catch (e) {
      toast({ title: 'Failed to load repo', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const loadGenerationIntoEditor = (gen: GenerationDetail) => {
    const analysis = JSON.parse(gen.analysisJson) as RepoAnalysis
    const sections = JSON.parse(gen.sectionsJson) as Section[]
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
    editor.load({
      generationId: gen.id,
      repoId: gen.repoId,
      repo: { id: gen.repoId, owner: gen.repo.owner, name: gen.repo.name, url: gen.repo.url },
      meta,
      analysis,
      sections,
    })
  }

  const handleDeleteRepo = async (repoId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this repo and all its generations? This cannot be undone.')) return
    try {
      const res = await fetch(`/api/repos/${repoId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      if (selectedRepoId === repoId) {
        editor.clear()
        setSelectedRepoId(null)
      }
      toast({ title: 'Repo deleted' })
      refreshRepos()
      refreshStats()
    } catch (e) {
      toast({ title: 'Delete failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  // Persist section edits (debounced).
  React.useEffect(() => {
    if (!editor.dirty || !editor.generationId) return
    const t = setTimeout(async () => {
      try {
        await fetch(`/api/generations/${editor.generationId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sections: editor.sections,
            readmeMarkdown: editor.markdown,
          }),
        })
        editor.markSaved()
      } catch (e) {
        console.warn('Autosave failed', e)
      }
    }, 800)
    return () => clearTimeout(t)
  }, [editor.dirty, editor.sections, editor.markdown, editor.generationId, editor])

  // Regenerate a single section.
  const handleRegenerate = async (sectionId: string) => {
    if (!editor.generationId || !editor.analysis || !editor.meta) return
    editor.setRegenerating(sectionId)
    try {
      const res = await fetch(`/api/generations/${editor.generationId}/regenerate-section`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sectionId }),
      })
      if (!res.ok) throw new Error('Failed to regenerate')
      const data = await res.json() as { section: Section }
      editor.replaceSection(data.section)
      toast({ title: 'Section regenerated' })
    } catch (e) {
      toast({ title: 'Regenerate failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      editor.setRegenerating(null)
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editor.markdown)
      toast({ title: 'README copied to clipboard' })
    } catch (e) {
      toast({ title: 'Copy failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const handleDownload = () => {
    const blob = new Blob([editor.markdown], { type: 'text/markdown' })
    const urlObj = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const safeName = editor.repo?.name || 'README'
    a.href = urlObj
    a.download = `README-${safeName}.md`
    a.click()
    URL.revokeObjectURL(urlObj)
    toast({ title: 'README downloaded' })
  }

  return (
    <main className="min-h-screen flex flex-col bg-background text-foreground">
      <Header stats={stats} />

      <div className="flex-1 grid gap-4 p-4 lg:grid-cols-[300px_1fr_360px] lg:gap-6 lg:p-6">
        {/* LEFT: Repo list */}
        <aside className="lg:sticky lg:top-[88px] lg:max-h-[calc(100vh-112px)] flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Analyze a GitHub repo</CardTitle>
              <CardDescription>Paste the URL. We&apos;ll fetch tree, manifest, top files, and recent commits.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="https://github.com/owner/repo"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !analyzing) handleAnalyze()
                }}
              />
              <Button onClick={handleAnalyze} disabled={analyzing} className="w-full">
                {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {analyzing ? 'Analyzing...' : 'Analyze & generate'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Unauthenticated GitHub API — 60 req/hr per IP. A repo with ~5 files + 30 commits uses ~8 requests.
              </p>
            </CardContent>
          </Card>

          <Card className="flex-1 min-h-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Analyzed repos</CardTitle>
              <CardDescription>{repos.length} repos stored locally</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-96 lg:max-h-[calc(100vh-280px)] scrollbar-thin">
                <div className="px-4 pb-4 space-y-2">
                  {loadingRepos && (
                    <div className="flex items-center justify-center py-8 text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" /> <span className="ml-2 text-sm">Loading...</span>
                    </div>
                  )}
                  {!loadingRepos && repos.length === 0 && (
                    <p className="text-sm text-muted-foreground py-6 text-center">
                      No repos yet. Analyze one to get started.
                    </p>
                  )}
                  {repos.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => handleSelectRepo(r.id)}
                      className={`w-full text-left rounded-md border p-3 transition-colors hover:bg-accent ${
                        selectedRepoId === r.id ? 'border-primary bg-accent' : 'border-border'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-mono text-sm truncate">
                          {r.owner}/{r.name}
                        </div>
                        <Trash2
                          className="size-3.5 text-muted-foreground hover:text-destructive"
                          onClick={(e) => handleDeleteRepo(r.id, e)}
                        />
                      </div>
                      {r.description && (
                        <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{r.description}</div>
                      )}
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {r.language && <Badge variant="secondary" className="text-[10px]">{r.language}</Badge>}
                        {r.stars !== null && (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <Star className="size-2.5" /> {r.stars}
                          </Badge>
                        )}
                        {r.lastAnalyzedAt && (
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(r.lastAnalyzedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </aside>

        {/* CENTER: README preview OR empty state */}
        <section className="min-h-0">
          {editor.analysis ? (
            <Card className="h-full flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle className="text-lg flex items-center gap-2 truncate">
                      <Github className="size-4" />
                      <span className="font-mono">{editor.repo?.owner}/{editor.repo?.name}</span>
                    </CardTitle>
                    <CardDescription className="mt-1 flex items-center gap-2">
                      {editor.meta?.defaultBranch && (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <GitBranch className="size-2.5" /> {editor.meta.defaultBranch}
                        </Badge>
                      )}
                      {editor.repo && (
                        <a
                          href={editor.repo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] hover:underline"
                        >
                          <ExternalLink className="size-2.5" /> open on GitHub
                        </a>
                      )}
                      {editor.dirty && <span className="text-[10px] text-amber-600">unsaved</span>}
                      {!editor.dirty && editor.savedAt && (
                        <span className="text-[10px] text-muted-foreground">saved</span>
                      )}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={handleCopy}>
                      <Copy className="size-3.5" /> Copy
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleDownload}>
                      <Download className="size-3.5" /> .md
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 p-0">
                <ScrollArea className="h-[calc(100vh-220px)] scrollbar-thin">
                  <div className="px-6 pb-6 markdown-body">
                    <ReactMarkdown>{editor.markdown}</ReactMarkdown>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          ) : (
            <EmptyState />
          )}
        </section>

        {/* RIGHT: Sections editor */}
        <aside className="lg:sticky lg:top-[88px] lg:max-h-[calc(100vh-112px)]">
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Sections editor</CardTitle>
              <CardDescription>Toggle, reorder, edit, or AI-regenerate each section.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 p-0">
              <ScrollArea className="h-[calc(100vh-220px)] scrollbar-thin">
                <div className="px-4 pb-4 space-y-3">
                  {!editor.analysis && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Analyze a repo to populate the section editor.
                    </p>
                  )}
                  {editor.sections.map((section, idx) => (
                    <SectionEditorCard
                      key={section.id}
                      section={section}
                      idx={idx}
                      total={editor.sections.length}
                      onToggle={() => editor.toggleSection(section.id)}
                      onMove={(dir) => editor.move(section.id, dir)}
                      onContent={(c) => editor.editContent(section.id, c)}
                      onLabel={(l) => editor.editLabel(section.id, l)}
                      onRegenerate={() => handleRegenerate(section.id)}
                      regenerating={editor.regeneratingId === section.id}
                    />
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </aside>
      </div>

      <Footer />
    </main>
  )
}

function Header({ stats }: { stats: StatsResponse }) {
  return (
    <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b">
      <div className="px-4 lg:px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-8 rounded-md bg-primary text-primary-foreground grid place-items-center font-mono font-bold">
            R
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-tight truncate">README Generator Copilot</h1>
            <p className="text-xs text-muted-foreground hidden sm:block">
              Paste a GitHub URL → get a beautiful, badge-ready README
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{stats.repos} repos</Badge>
          <Badge variant="secondary">{stats.generations} generations</Badge>
        </div>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="mt-auto border-t bg-muted/30 py-3 px-4 lg:px-6 text-center text-xs text-muted-foreground">
      README Generator Copilot — analyzes public GitHub repos via the REST API (60 req/hr) and generates a
      badge-ready README with an editable section editor. MVP export is copy / .md download.
    </footer>
  )
}

function EmptyState() {
  return (
    <Card className="h-full flex items-center justify-center">
      <CardContent className="text-center py-12 px-6 max-w-md">
        <FileCode className="size-10 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold mb-2">No README loaded</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Paste a public GitHub URL in the left panel and click <span className="font-medium">Analyze &amp; generate</span>.
          The README preview and section editor will populate here.
        </p>
        <div className="text-xs text-muted-foreground space-y-1">
          <p>Supported manifests: package.json, pyproject.toml, Cargo.toml, go.mod</p>
          <p>Limited to 60 GitHub API requests/hour per IP (unauthenticated)</p>
        </div>
      </CardContent>
    </Card>
  )
}

interface SectionEditorCardProps {
  section: Section
  idx: number
  total: number
  onToggle: () => void
  onMove: (dir: -1 | 1) => void
  onContent: (content: string) => void
  onLabel: (label: string) => void
  onRegenerate: () => void
  regenerating: boolean
}

function SectionEditorCard(props: SectionEditorCardProps) {
  const { section, idx, total } = props
  return (
    <div
      className={`rounded-md border p-3 space-y-2 transition-opacity ${
        section.enabled ? 'border-border bg-card' : 'border-dashed border-border bg-muted/40 opacity-60'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Switch checked={section.enabled} onCheckedChange={props.onToggle} aria-label="Toggle section" />
          <Input
            value={section.label}
            onChange={(e) => props.onLabel(e.target.value)}
            className="h-7 text-sm font-medium"
          />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => props.onMove(-1)}
            disabled={idx === 0}
            aria-label="Move section up"
          >
            <ArrowUp className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => props.onMove(1)}
            disabled={idx === total - 1}
            aria-label="Move section down"
          >
            <ArrowDown className="size-3.5" />
          </Button>
        </div>
      </div>
      <Textarea
        value={section.content}
        onChange={(e) => props.onContent(e.target.value)}
        disabled={!section.enabled}
        className="min-h-24 text-xs font-mono"
        aria-label={`Edit content for ${section.label}`}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {section.content.length} chars
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={props.onRegenerate}
          disabled={!section.enabled || props.regenerating}
        >
          {props.regenerating ? (
            <>
              <Loader2 className="size-3 animate-spin" /> Regenerating...
            </>
          ) : (
            <>
              <Sparkles className="size-3" /> Regenerate
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
