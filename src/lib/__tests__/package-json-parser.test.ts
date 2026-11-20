import { test, expect, describe } from 'bun:test'
import { parseManifest } from '../package-json-parser'

describe('parseManifest — npm package.json', () => {
  const npmJson = JSON.stringify({
    name: 'my-pkg',
    version: '1.2.3',
    description: 'A test package',
    license: 'MIT',
    scripts: { dev: 'next dev', build: 'next build', test: 'bun test' },
    dependencies: { react: '^19.0.0', next: '^16.0.0' },
    devDependencies: { typescript: '^5.0.0' },
  })
  test('parses npm package.json', () => {
    const m = parseManifest(npmJson, 'package.json')
    expect(m).not.toBeNull()
    expect(m!.ecosystem).toBe('npm')
    expect(m!.name).toBe('my-pkg')
    expect(m!.version).toBe('1.2.3')
    expect(m!.description).toBe('A test package')
    expect(m!.license).toBe('MIT')
    expect(m!.scripts.dev).toBe('next dev')
    expect(m!.dependencies.react).toBe('^19.0.0')
    expect(m!.devDependencies.typescript).toBe('^5.0.0')
  })
  test('sniffs npm from content when filename omitted', () => {
    const m = parseManifest(npmJson)
    expect(m).not.toBeNull()
    expect(m!.ecosystem).toBe('npm')
    expect(m!.name).toBe('my-pkg')
  })
  test('handles object-form license', () => {
    const json = JSON.stringify({ name: 'x', version: '1.0.0', license: { type: 'Apache-2.0' } })
    const m = parseManifest(json, 'package.json')
    expect(m!.license).toBe('Apache-2.0')
  })
  test('returns null for invalid JSON', () => {
    expect(parseManifest('{not valid json', 'package.json')).toBeNull()
  })
  test('returns null when name missing', () => {
    expect(parseManifest(JSON.stringify({ version: '1.0.0' }), 'package.json')).toBeNull()
  })
})

describe('parseManifest — pyproject.toml', () => {
  const poetryToml = `
[tool.poetry]
name = "my-app"
version = "0.4.1"
description = "Poetry project"
license = "MIT"
authors = ["dev <dev@example.com>"]

[tool.poetry.dependencies]
python = "^3.10"
fastapi = "^0.110"
pydantic = "^2.5"

[tool.poetry.group.dev.dependencies]
pytest = "^8.0"

[tool.poetry.scripts]
my-app = "my_app.cli:main"
`
  test('parses Poetry project', () => {
    const m = parseManifest(poetryToml, 'pyproject.toml')
    expect(m).not.toBeNull()
    expect(m!.ecosystem).toBe('poetry')
    expect(m!.name).toBe('my-app')
    expect(m!.version).toBe('0.4.1')
    expect(m!.description).toBe('Poetry project')
    expect(m!.license).toBe('MIT')
    expect(m!.scripts['my-app']).toBe('my_app.cli:main')
    expect(Object.keys(m!.dependencies)).toContain('fastapi')
    expect(Object.keys(m!.devDependencies)).toContain('pytest')
  })
  test('parses PEP-621 [project] table', () => {
    const pep621 = `
[project]
name = "modern-py"
version = "2.0.0"
description = "PEP-621 style project"
license = "Apache-2.0"

[project.dependencies]
flask = ">=2.0"
requests = ">=2.28"

[project.scripts]
modern = "modern_py.cli:main"
`
    const m = parseManifest(pep621, 'pyproject.toml')
    expect(m).not.toBeNull()
    expect(m!.ecosystem).toBe('pep621')
    expect(m!.name).toBe('modern-py')
    expect(m!.version).toBe('2.0.0')
    expect(Object.keys(m!.dependencies)).toContain('flask')
    expect(m!.scripts.modern).toBe('modern_py.cli:main')
  })
})

describe('parseManifest — Cargo.toml', () => {
  const cargoToml = `
[package]
name = "rust-app"
version = "0.2.0"
edition = "2021"
description = "A Rust project"
license = "MIT OR Apache-2.0"

[dependencies]
serde = "1.0"
tokio = { version = "1", features = ["full"] }
`
  test('parses Cargo.toml package + deps', () => {
    const m = parseManifest(cargoToml, 'Cargo.toml')
    expect(m).not.toBeNull()
    expect(m!.ecosystem).toBe('cargo')
    expect(m!.name).toBe('rust-app')
    expect(m!.version).toBe('0.2.0')
    expect(m!.license).toBe('MIT OR Apache-2.0')
    expect(Object.keys(m!.dependencies)).toContain('serde')
    expect(Object.keys(m!.dependencies)).toContain('tokio')
  })
})

describe('parseManifest — go.mod', () => {
  const goMod = `module github.com/acme/widgets

go 1.22

require (
    github.com/gin-gonic/gin v1.10.0
    github.com/lib/pq v1.10.9
)

require github.com/stretchr/testify v1.9.0
`
  test('parses go.mod module + go version + deps', () => {
    const m = parseManifest(goMod, 'go.mod')
    expect(m).not.toBeNull()
    expect(m!.ecosystem).toBe('go')
    expect(m!.name).toBe('widgets')
    expect(m!.version).toBe('1.22')
    expect(Object.keys(m!.dependencies)).toContain('github.com/gin-gonic/gin')
    expect(Object.keys(m!.dependencies)).toContain('github.com/stretchr/testify')
  })
  test('rejects non-module content', () => {
    expect(parseManifest('hello world\n', 'go.mod')).toBeNull()
  })
})

describe('parseManifest — content sniffing', () => {
  test('returns null for unknown content', () => {
    expect(parseManifest('just plain text\nno manifest here')).toBeNull()
  })
  test('returns null for empty input', () => {
    expect(parseManifest('')).toBeNull()
  })
})
