/**
 * Zustand store for the README editor client state.
 * Holds the currently-loaded generation (analysis + sections + meta),
 * plus the rendered markdown string (recomputed whenever sections change).
 */
'use client'

import { create } from 'zustand'
import type { RepoAnalysis, RepoMeta, Section } from '@/lib/types'
import { renderReadme } from '@/lib/readme-renderer'
import {
  toggleSection as toggleSectionFn,
  editSectionContent as editContentFn,
  editSectionLabel as editLabelFn,
  reorderSections as reorderFn,
  replaceSection as replaceFn,
} from '@/lib/section-toggle'

export interface GenerationState {
  generationId: string | null
  repoId: string | null
  repo: { id: string; owner: string; name: string; url: string } | null
  meta: RepoMeta | null
  analysis: RepoAnalysis | null
  sections: Section[]
  /** Rendered README string. Updated by `rerender()`. */
  markdown: string
  /** True while a section is being regenerated. */
  regeneratingId: string | null
  /** True when the local state has unsaved edits pending a PATCH. */
  dirty: boolean
  /** Set after a PATCH succeeds. */
  savedAt: number | null
}

export interface GenerationActions {
  load(payload: {
    generationId: string
    repoId: string
    repo: { id: string; owner: string; name: string; url: string }
    meta: RepoMeta
    analysis: RepoAnalysis
    sections: Section[]
  }): void
  clear(): void
  toggleSection(id: string): void
  editContent(id: string, content: string): void
  editLabel(id: string, label: string): void
  move(id: string, dir: -1 | 1): void
  replaceSection(updated: Section): void
  setRegenerating(id: string | null): void
  markSaved(): void
}

function rerender(analysis: RepoAnalysis | null, sections: Section[], meta: RepoMeta | null): string {
  if (!analysis) return ''
  return renderReadme(analysis, sections, meta ?? undefined)
}

export const useEditorStore = create<GenerationState & GenerationActions>((set, get) => ({
  generationId: null,
  repoId: null,
  repo: null,
  meta: null,
  analysis: null,
  sections: [],
  markdown: '',
  regeneratingId: null,
  dirty: false,
  savedAt: null,

  load(payload) {
    const markdown = rerender(payload.analysis, payload.sections, payload.meta)
    set({
      generationId: payload.generationId,
      repoId: payload.repoId,
      repo: payload.repo,
      meta: payload.meta,
      analysis: payload.analysis,
      sections: payload.sections,
      markdown,
      regeneratingId: null,
      dirty: false,
      savedAt: null,
    })
  },
  clear() {
    set({
      generationId: null,
      repoId: null,
      repo: null,
      meta: null,
      analysis: null,
      sections: [],
      markdown: '',
      regeneratingId: null,
      dirty: false,
      savedAt: null,
    })
  },
  toggleSection(id) {
    const s = get()
    const sections = toggleSectionFn(s.sections, id)
    set({ sections, markdown: rerender(s.analysis, sections, s.meta), dirty: true })
  },
  editContent(id, content) {
    const s = get()
    const sections = editContentFn(s.sections, id, content)
    set({ sections, markdown: rerender(s.analysis, sections, s.meta), dirty: true })
  },
  editLabel(id, label) {
    const s = get()
    const sections = editLabelFn(s.sections, id, label)
    set({ sections, markdown: rerender(s.analysis, sections, s.meta), dirty: true })
  },
  move(id, dir) {
    const s = get()
    const idx = s.sections.findIndex((x) => x.id === id)
    if (idx === -1) return
    const sections = reorderFn(s.sections, idx, idx + dir)
    set({ sections, markdown: rerender(s.analysis, sections, s.meta), dirty: true })
  },
  replaceSection(updated) {
    const s = get()
    const sections = replaceFn(s.sections, updated)
    set({
      sections,
      markdown: rerender(s.analysis, sections, s.meta),
      regeneratingId: null,
      dirty: true,
    })
  },
  setRegenerating(id) {
    set({ regeneratingId: id })
  },
  markSaved() {
    set({ dirty: false, savedAt: Date.now() })
  },
}))
