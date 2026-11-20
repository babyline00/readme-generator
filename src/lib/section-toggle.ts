/**
 * Pure-function section state transitions for the README editor.
 *
 * A "sections" state is an ordered array of Section objects. The renderer
 * walks the array in order, emitting only the enabled sections.
 */

import type { Section } from '@/lib/types'

export function toggleSection(sections: Section[], id: string): Section[] {
  return sections.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
}

export function enableSection(sections: Section[], id: string, enabled: boolean): Section[] {
  return sections.map((s) => (s.id === id ? { ...s, enabled } : s))
}

/**
 * Move a section from index `from` to index `to`.
 *
 * Negative or out-of-bounds indices are clamped. If `from === to` or `from` is
 * invalid, the array is returned unchanged (but always a shallow copy so the
 * caller can rely on referential change).
 */
export function reorderSections(sections: Section[], from: number, to: number): Section[] {
  if (from < 0 || from >= sections.length) return [...sections]
  if (to < 0) to = 0
  if (to >= sections.length) to = sections.length - 1
  if (from === to) return [...sections]
  const next = [...sections]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Convenience wrapper: reorder by id rather than index.
 */
export function moveSectionById(sections: Section[], id: string, dir: -1 | 1): Section[] {
  const idx = sections.findIndex((s) => s.id === id)
  if (idx === -1) return [...sections]
  return reorderSections(sections, idx, idx + dir)
}

export function editSectionContent(sections: Section[], id: string, content: string): Section[] {
  return sections.map((s) => (s.id === id ? { ...s, content } : s))
}

export function editSectionLabel(sections: Section[], id: string, label: string): Section[] {
  return sections.map((s) => (s.id === id ? { ...s, label } : s))
}

export function findSection(sections: Section[], id: string): Section | undefined {
  return sections.find((s) => s.id === id)
}

/**
 * Replace a single section with a new instance (used after regenerating one
 * section via the LLM). Preserves ordering.
 */
export function replaceSection(sections: Section[], updated: Section): Section[] {
  return sections.map((s) => (s.id === updated.id ? updated : s))
}
