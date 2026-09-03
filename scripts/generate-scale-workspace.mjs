// Generates a synthetic workspace of a given size, to measure how Nix
// evaluation scales with project count.
//
// Deterministic: shapes and contents come from the project index, never from a
// clock or an unseeded random source, so the same count always produces the
// same workspace.
//
// The output is a self-contained flake: the repository's tracked files are
// copied in, minus packages/ and apps/, and generated projects put in their
// place. That way the generated workspace does not depend on the real one
// while it is being edited, and the real one keeps the numbers it is cited for.
//
// Evaluation needs no install and no network. A fixed-output derivation's path
// depends only on its name and hash, so pnpmDeps evaluates fine without ever
// being fetched, and nothing here is built.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const count = Number(process.argv[2] ?? 50)
const outDir = process.argv[3] ?? `scale/${count}`
// "varied" gives packages uneven module counts, test-file counts and file
// lengths, to check whether a uniform synthetic workspace understates
// evaluation cost.
const varied = process.argv[4] === 'varied'
const SCOPE = '@nx-exp'

if (!Number.isInteger(count) || count < 8) {
  throw new Error(`project count must be an integer of at least 8, got ${process.argv[2]}`)
}

// A small deterministic sequence, so dependency picks vary without a clock.
const pick = (seed, bound) => (Math.imul(seed + 1, 2654435761) >>> 0) % bound

// Layered so the shapes the real workspace was built for appear in proportion:
// a shared foundation, fan-out, fan-in and diamonds through the middle layers,
// isolated chains, orphans, and applications on top.
const plan = () => {
  const projects = []
  const add = (project) => {
    projects.push(project)
    return projects.length - 1
  }

  add({ name: 'foundation', kind: 'package', deps: [] })

  const share = (fraction) => Math.max(1, Math.round(count * fraction))
  const lower = share(0.18)
  const middle = share(0.3)
  const domain = share(0.24)
  const apps = share(0.08)
  const orphans = share(0.05)

  add({ name: 'testkit', kind: 'package', deps: [0] })

  const lowerIdx = []
  for (let i = 0; i < lower; i++) {
    lowerIdx.push(add({ name: `lower-${i}`, kind: 'package', deps: [0] }))
  }
  const middleIdx = []
  for (let i = 0; i < middle; i++) {
    // Two parents from the layer below: fan-in, and a diamond over foundation.
    const a = lowerIdx[pick(i, lowerIdx.length)]
    const b = lowerIdx[pick(i + 7, lowerIdx.length)]
    middleIdx.push(
      add({
        name: `middle-${i}`,
        kind: 'package',
        deps: [...new Set([a, b])],
        devDeps: i % 3 === 0 ? [1] : [],
      }),
    )
  }
  const domainIdx = []
  for (let i = 0; i < domain; i++) {
    const a = middleIdx[pick(i + 3, middleIdx.length)]
    const b = middleIdx[pick(i + 11, middleIdx.length)]
    domainIdx.push(
      add({
        name: `domain-${i}`,
        kind: 'package',
        deps: [...new Set([a, b])],
        devDeps: i % 4 === 0 ? [1] : [],
      }),
    )
  }
  for (let i = 0; i < apps; i++) {
    const a = domainIdx[pick(i + 5, domainIdx.length)]
    const b = domainIdx[pick(i + 13, domainIdx.length)]
    add({ name: `app-${i}`, kind: 'app', deps: [...new Set([a, b])] })
  }

  // Isolated chains, so a change at the bottom affects a known small set.
  let remaining = count - projects.length - orphans
  let chain = 0
  while (remaining >= 4) {
    let previous = null
    for (let step = 0; step < 4; step++) {
      previous = add({
        name: `chain-${chain}-${step}`,
        kind: 'package',
        deps: previous === null ? [] : [previous],
      })
    }
    remaining -= 4
    chain += 1
  }
  for (let i = 0; i < Math.max(0, count - projects.length); i++) {
    add({ name: `orphan-${i}`, kind: 'package', deps: [] })
  }
  return projects.slice(0, count)
}

const projects = plan()
const rootOf = (project) =>
  `${project.kind === 'app' ? 'apps' : 'packages'}/${project.name}`

const write = (path, body) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
}

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// The repository's own tracked files, minus the hand-written workspace.
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((file) => !file.startsWith('packages/') && !file.startsWith('apps/'))
for (const file of tracked) {
  mkdirSync(dirname(join(outDir, file)), { recursive: true })
  cpSync(file, join(outDir, file))
}

for (const [index, project] of projects.entries()) {
  const root = rootOf(project)
  const deps = (project.deps ?? []).map((i) => projects[i])
  const devDeps = (project.devDeps ?? []).map((i) => projects[i])

  write(
    join(outDir, root, 'package.json'),
    `${JSON.stringify(
      {
        name: `${SCOPE}/${project.name}`,
        version: '0.0.1',
        type: 'module',
        main: './dist/index.js',
        types: './dist/index.d.ts',
        exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
        scripts: { build: 'tsc -p tsconfig.json' },
        ...(deps.length > 0
          ? {
              dependencies: Object.fromEntries(
                deps.map((dep) => [`${SCOPE}/${dep.name}`, 'workspace:*']),
              ),
            }
          : {}),
        ...(devDeps.length > 0
          ? {
              devDependencies: Object.fromEntries(
                devDeps.map((dep) => [`${SCOPE}/${dep.name}`, 'workspace:*']),
              ),
            }
          : {}),
      },
      null,
      2,
    )}\n`,
  )

  write(
    join(outDir, root, 'tsconfig.json'),
    `${JSON.stringify(
      {
        extends: '../../tsconfig.base.json',
        compilerOptions: { rootDir: 'src', outDir: 'dist' },
        include: ['src/**/*'],
      },
      null,
      2,
    )}\n`,
  )

  write(
    join(outDir, root, 'vitest.config.ts'),
    `import { mergeConfig, defineConfig } from 'vitest/config'\n` +
      `import shared from '../../vitest.shared'\n\n` +
      `export default mergeConfig(shared, defineConfig({ test: { name: '${project.name}' } }))\n`,
  )

  const identifier = project.name.replace(/-/g, '_')
  const imports = deps
    .map(
      (dep, i) =>
        `import { value as dep${i} } from '${SCOPE}/${dep.name}'`,
    )
    .join('\n')
  const sum = deps.length > 0 ? deps.map((_, i) => `dep${i}`).join(' + ') : '0'

  // With variation on, packages differ in how many modules and test files they
  // hold and how long each file is. Evaluation copies every project directory
  // into the store, so file count and size are what could make a real workspace
  // evaluate differently from a uniform synthetic one. Derived from the index,
  // so it stays deterministic.
  const localModules = varied ? 1 + (index % 8) : 1
  const testFiles = varied ? 1 + (index % 3) : 1
  const padLines = varied ? 20 + (index % 5) * 60 : 0

  const padding = (label) =>
    padLines === 0
      ? ''
      : '\n' +
        Array.from(
          { length: padLines },
          (_, i) => `const ${label}_pad_${i}: number = ${(i * 7 + index) % 101}`,
        ).join('\n') +
        '\n'

  // Local modules, each importing the previous one, so a package has import
  // depth of its own rather than only cross-package edges.
  for (let m = 0; m < localModules; m++) {
    const previous = m === 0 ? null : `./mod${m - 1}.js`
    write(
      join(outDir, root, 'src', `mod${m}.ts`),
      (previous ? `import { step as previous } from '${previous}'\n\n` : '') +
        `export function step(n: number): number {\n` +
        `  return ${previous ? 'previous(n)' : 'n'} + ${m + 1}\n` +
        `}\n` +
        padding(`mod${m}`),
    )
  }

  write(
    join(outDir, root, 'src', 'index.ts'),
    `${imports}${imports ? '\n' : ''}` +
      `import { step } from './mod${localModules - 1}.js'\n\n` +
      `export const value: number = ${index} + ${sum}\n\n` +
      `export function scale_${identifier}(n: number): number {\n` +
      `  let total = value + step(n)\n` +
      `  for (let i = 0; i < n; i++) total += (i * ${index + 1}) % 7\n` +
      `  return total\n` +
      `}\n` +
      padding('index'),
  )

  for (let t = 0; t < testFiles; t++) {
    write(
      join(outDir, root, 'tests', `part${t}.test.ts`),
      `import { describe, expect, it } from 'vitest'\n` +
        `import { value, scale_${identifier} } from '../src/index.js'\n\n` +
        `describe('${project.name} part ${t}', () => {\n` +
        `  it('sums its own index with its dependencies', () => {\n` +
        `    expect(value).toBeGreaterThanOrEqual(${index})\n` +
        `  })\n\n` +
        `  it('accumulates deterministically', () => {\n` +
        `    expect(scale_${identifier}(${t + 10})).toBe(scale_${identifier}(${t + 10}))\n` +
        `  })\n` +
        `})\n`,
    )
  }
}

const edges = projects.reduce(
  (n, project) => n + (project.deps?.length ?? 0) + (project.devDeps?.length ?? 0),
  0,
)
console.error(
  `generated ${outDir}: ${projects.length} projects, ${edges} edges, ` +
    `${projects.length} test files`,
)
