// Prototype 5: for one package's test, does each system treat a given file as
// an input?
//
// The two systems express the same idea differently. Nx names filesets for the
// task and its dependencies (`^sources`). Nix names files for the derivation
// and then reaches dependency sources only through the dependency build
// derivations it references. To compare them, the Nix side is expanded
// transitively: a file counts as a Nix input to foo:test if it is in the test
// derivation's own source, or in the source of any build derivation in its
// closure.
//
// Every file in the repository is classified, so a disagreement cannot hide in
// a file neither list happened to mention.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { createProjectGraphAsync } from '@nx/devkit'
import { readNxJson } from 'nx/src/config/configuration.js'
import { createProjectFileMapUsingProjectGraph } from 'nx/src/project-graph/file-map-utils.js'
import { createTaskGraph } from 'nx/src/tasks-runner/create-task-graph.js'
import {
  expandNamedInput,
  extractPatternsFromFileSets,
  filterUsingGlobPatterns,
  getInputs,
  getNamedInputs,
} from 'nx/src/hasher/task-hasher.js'

const outputPath = process.argv[2] ?? 'results/input-comparison.json'

const run = (command, args) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NX_DAEMON: 'false' },
  })

const table = JSON.parse(readFileSync('nix/projects.json', 'utf8')).projects
const repoFiles = run('git', ['ls-files']).split('\n').filter(Boolean).sort()

const nxJson = readNxJson()
const projectGraph = await createProjectGraphAsync({ exitOnError: false })
const fileMap = await createProjectFileMapUsingProjectGraph(projectGraph)
const projectNames = Object.keys(projectGraph.nodes).sort()

const taskGraph = createTaskGraph(
  projectGraph,
  nxJson.targetDefaults ?? {},
  projectNames,
  ['test'],
  undefined,
  {},
)

const nodeFor = (projectName) => projectGraph.nodes[projectName]

const filesOfProject = (projectName) => fileMap[projectName] ?? []

// Nx expands a fileset either against a project's own files or against the
// workspace root; the two need different handling.
const expandFilesets = (projectName, filesets) => {
  const patterns = extractPatternsFromFileSets(filesets)
  const projectPatterns = patterns.filter((p) => p.startsWith('{projectRoot}'))
  const workspacePatterns = patterns.filter((p) => p.startsWith('{workspaceRoot}'))

  const matched = new Set(
    filterUsingGlobPatterns(
      nodeFor(projectName).data.root,
      filesOfProject(projectName),
      projectPatterns,
    ).map((file) => file.file),
  )
  for (const pattern of workspacePatterns) {
    const path = pattern.replace('{workspaceRoot}/', '')
    if (repoFiles.includes(path)) matched.add(path)
  }
  return matched
}

const transitiveDeps = (projectName) => {
  const seen = new Set()
  const pending = [projectName]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const edge of projectGraph.dependencies[current] ?? []) {
      if (!(edge.target in projectGraph.nodes)) continue
      if (seen.has(edge.target)) continue
      seen.add(edge.target)
      pending.push(edge.target)
    }
  }
  return [...seen]
}

const nxInputsFor = (projectName) => {
  const task = taskGraph.tasks[`${projectName}:test`]
  const { selfInputs, depsInputs } = getInputs(task, projectGraph, nxJson)
  const files = expandFilesets(projectName, selfInputs)

  // `^input` applies the named input to every dependency, transitively.
  for (const { input } of depsInputs) {
    for (const dep of transitiveDeps(projectName)) {
      const namedInputs = getNamedInputs(nxJson, nodeFor(dep))
      const expanded = expandNamedInput(input, namedInputs)
      for (const file of expandFilesets(dep, expanded)) files.add(file)
    }
  }
  return files
}

const srcFilesOf = (attr) => {
  const storePath = run('nix', ['eval', '--raw', `.#${attr}.src`]).trim()
  if (!existsSync(storePath)) throw new Error(`missing source path for ${attr}`)
  return run('find', [storePath, '-type', 'f'])
    .split('\n')
    .filter(Boolean)
    .map((path) => relative(storePath, path))
}

const buildSrcCache = new Map()
const buildSrcFilesOf = (attr) => {
  if (!buildSrcCache.has(attr)) buildSrcCache.set(attr, srcFilesOf(`build-${attr}`))
  return buildSrcCache.get(attr)
}

// Every test derivation depends on the pnpm install, so the files that install
// reads are inputs to every test. They enter as reduced manifests rather than
// verbatim: only the dependency-relevant fields of each package.json are read,
// so a description change in any manifest is not an input even though the file
// is listed here.
const installInputFiles = () => [
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'package.json',
  ...Object.values(table).map((project) => `${project.root}/package.json`),
]

const nixInputsFor = (attr) => {
  const project = table[attr]
  const files = new Set([...srcFilesOf(`test-${attr}`), ...installInputFiles()])
  // Dependency sources reach the test only through the build derivations its
  // closure references.
  const pending = [...project.runtimeDeps, ...project.devDeps]
  const seen = new Set(pending)
  while (pending.length > 0) {
    const dep = pending.pop()
    for (const file of buildSrcFilesOf(dep)) files.add(file)
    for (const next of table[dep].runtimeDeps) {
      if (!seen.has(next)) {
        seen.add(next)
        pending.push(next)
      }
    }
  }
  return files
}

// A file that should affect foo:test. For foo itself that is its sources, its
// tests and its own configuration. For a dependency it is only what ends up in
// that dependency's build output: a dependency's own test files and vitest
// config are read by nothing downstream.
const shouldAffect = (attr, file) => {
  const project = table[attr]
  const workspaceInputs = [
    'tsconfig.base.json',
    'vitest.shared.ts',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'package.json',
  ]
  if (workspaceInputs.includes(file)) return true

  const compiledFrom = (rest) =>
    rest.startsWith('src/') || rest === 'package.json' || rest === 'tsconfig.json'

  if (file.startsWith(`${project.root}/`)) {
    const rest = file.slice(project.root.length + 1)
    return compiledFrom(rest) || rest.startsWith('tests/') || rest === 'vitest.config.ts'
  }

  const depRoots = new Set()
  const collect = (dep) => {
    if (depRoots.has(table[dep].root)) return
    depRoots.add(table[dep].root)
    for (const next of table[dep].runtimeDeps) collect(next)
  }
  for (const dep of [...project.runtimeDeps, ...project.devDeps]) collect(dep)

  for (const root of depRoots) {
    if (file.startsWith(`${root}/`)) return compiledFrom(file.slice(root.length + 1))
  }
  return false
}

const SUBJECTS = process.argv[3]
  ? process.argv[3].split(',')
  : ['core', 'orphan', 'runtime', 'parser']

const comparisons = {}
for (const attr of SUBJECTS) {
  const projectName = table[attr].name
  const nxFiles = nxInputsFor(projectName)
  const nixFiles = nixInputsFor(attr)

  const rows = repoFiles
    .map((file) => ({
      file,
      nx: nxFiles.has(file),
      nix: nixFiles.has(file),
      shouldAffect: shouldAffect(attr, file),
    }))
    .filter((row) => row.nx || row.nix || row.shouldAffect)

  comparisons[attr] = {
    project: projectName,
    counts: {
      nx: rows.filter((r) => r.nx).length,
      nix: rows.filter((r) => r.nix).length,
      shouldAffect: rows.filter((r) => r.shouldAffect).length,
    },
    disagreements: rows.filter((r) => r.nx !== r.nix),
    missedByNx: rows.filter((r) => r.shouldAffect && !r.nx),
    missedByNix: rows.filter((r) => r.shouldAffect && !r.nix),
    rows,
  }

  const c = comparisons[attr]
  console.error(
    `${attr.padEnd(10)} nx ${String(c.counts.nx).padStart(3)}  nix ${String(c.counts.nix).padStart(3)}` +
      `  should ${String(c.counts.shouldAffect).padStart(3)}` +
      `  disagree ${String(c.disagreements.length).padStart(2)}` +
      `  missedByNx ${String(c.missedByNx.length).padStart(2)}` +
      `  missedByNix ${String(c.missedByNix.length).padStart(2)}`,
  )
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify({ repoFileCount: repoFiles.length, comparisons }, null, 2)}\n`)
console.error(`wrote ${outputPath}`)
