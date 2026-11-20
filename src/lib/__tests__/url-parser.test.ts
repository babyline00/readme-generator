import { test, expect, describe } from 'bun:test'
import { parseRepoUrl, repoUrl } from '../url-parser'

describe('parseRepoUrl', () => {
  test('parses https://github.com/owner/repo', () => {
    expect(parseRepoUrl('https://github.com/facebook/react')).toEqual({ owner: 'facebook', name: 'react' })
  })
  test('parses https://github.com/owner/repo/tree/branch', () => {
    expect(parseRepoUrl('https://github.com/owner/repo/tree/main')).toEqual({ owner: 'owner', name: 'repo' })
  })
  test('strips .git suffix from https URL', () => {
    expect(parseRepoUrl('https://github.com/owner/repo.git')).toEqual({ owner: 'owner', name: 'repo' })
  })
  test('parses git@ SSH form', () => {
    expect(parseRepoUrl('git@github.com:owner/repo.git')).toEqual({ owner: 'owner', name: 'repo' })
  })
  test('parses git@ SSH form without .git', () => {
    expect(parseRepoUrl('git@github.com:owner/repo')).toEqual({ owner: 'owner', name: 'repo' })
  })
  test('rejects non-github.com host', () => {
    expect(parseRepoUrl('https://gitlab.com/owner/repo')).toBeNull()
    expect(parseRepoUrl('https://bitbucket.org/owner/repo')).toBeNull()
  })
  test('rejects malformed input', () => {
    expect(parseRepoUrl('')).toBeNull()
    expect(parseRepoUrl('not a url')).toBeNull()
    expect(parseRepoUrl('https://github.com/only-one-part')).toBeNull()
  })
  test('rejects enterprise github hosts', () => {
    expect(parseRepoUrl('https://github.mycompany.com/owner/repo')).toBeNull()
  })
  test('repoUrl builds canonical URL', () => {
    expect(repoUrl('facebook', 'react')).toBe('https://github.com/facebook/react')
  })
  test('trims surrounding whitespace', () => {
    expect(parseRepoUrl('  https://github.com/owner/repo  ')).toEqual({ owner: 'owner', name: 'repo' })
  })
})
