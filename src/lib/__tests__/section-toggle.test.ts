import { test, expect, describe } from 'bun:test'
import {
  toggleSection,
  reorderSections,
  editSectionContent,
  enableSection,
  moveSectionById,
  replaceSection,
  findSection,
} from '../section-toggle'
import type { Section } from '@/lib/types'

function baseSections(): Section[] {
  return [
    { id: 'a', label: 'A', enabled: true, content: 'aaa' },
    { id: 'b', label: 'B', enabled: true, content: 'bbb' },
    { id: 'c', label: 'C', enabled: false, content: 'ccc' },
    { id: 'd', label: 'D', enabled: true, content: 'ddd' },
  ]
}

describe('toggleSection', () => {
  test('flips enabled on matching id', () => {
    const next = toggleSection(baseSections(), 'a')
    expect(next.find((s) => s.id === 'a')!.enabled).toBe(false)
  })
  test('flips disabled section back on', () => {
    const next = toggleSection(baseSections(), 'c')
    expect(next.find((s) => s.id === 'c')!.enabled).toBe(true)
  })
  test('returns array of same length', () => {
    const next = toggleSection(baseSections(), 'a')
    expect(next).toHaveLength(4)
  })
  test('does not mutate original array', () => {
    const orig = baseSections()
    const origA = orig.find((s) => s.id === 'a')!.enabled
    toggleSection(orig, 'a')
    expect(orig.find((s) => s.id === 'a')!.enabled).toBe(origA)
  })
})

describe('enableSection', () => {
  test('forces enabled=true', () => {
    const next = enableSection(baseSections(), 'c', true)
    expect(next.find((s) => s.id === 'c')!.enabled).toBe(true)
  })
  test('forces enabled=false', () => {
    const next = enableSection(baseSections(), 'a', false)
    expect(next.find((s) => s.id === 'a')!.enabled).toBe(false)
  })
})

describe('reorderSections', () => {
  test('moves section from index 0 to index 2', () => {
    const next = reorderSections(baseSections(), 0, 2)
    expect(next.map((s) => s.id)).toEqual(['b', 'c', 'a', 'd'])
  })
  test('moves section from index 3 to index 0', () => {
    const next = reorderSections(baseSections(), 3, 0)
    expect(next.map((s) => s.id)).toEqual(['d', 'a', 'b', 'c'])
  })
  test('out-of-bounds from returns unchanged order', () => {
    const next = reorderSections(baseSections(), 99, 0)
    expect(next.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  test('clamps negative to', () => {
    // `to = -1` is clamped to 0 → moving the section at index 2 ('c') to the front.
    const next = reorderSections(baseSections(), 2, -1)
    expect(next.map((s) => s.id)).toEqual(['c', 'a', 'b', 'd'])
  })
})

describe('moveSectionById', () => {
  test('moves a section up by id', () => {
    const next = moveSectionById(baseSections(), 'd', -1)
    expect(next.map((s) => s.id)).toEqual(['a', 'b', 'd', 'c'])
  })
  test('no-op when id not found returns copy', () => {
    const orig = baseSections()
    const next = moveSectionById(orig, 'zzz', -1)
    expect(next.map((s) => s.id)).toEqual(orig.map((s) => s.id))
  })
})

describe('editSectionContent', () => {
  test('updates content of matching section', () => {
    const next = editSectionContent(baseSections(), 'b', 'new content')
    expect(next.find((s) => s.id === 'b')!.content).toBe('new content')
  })
  test('returns new array (immutability)', () => {
    const orig = baseSections()
    const next = editSectionContent(orig, 'a', 'x')
    expect(next).not.toBe(orig)
  })
})

describe('replaceSection + findSection', () => {
  test('replaceSection swaps in place preserving order', () => {
    const next = replaceSection(baseSections(), { id: 'b', label: 'B new', enabled: true, content: 'updated' })
    expect(next.find((s) => s.id === 'b')!.content).toBe('updated')
    expect(next.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  test('findSection returns the section by id', () => {
    expect(findSection(baseSections(), 'c')?.enabled).toBe(false)
    expect(findSection(baseSections(), 'nope')).toBeUndefined()
  })
})
