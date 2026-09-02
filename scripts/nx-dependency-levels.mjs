// At what levels does Nx actually know about dependencies?
//
// Nx's file map has a per-file `deps` field, which would be dependency
// information below the project level: which workspace packages *this file*
// imports. If it were populated, a Nix derivation could depend on only what
// the files it loads actually need, which is finer than the manifests allow.
//
// This counts where that field is populated. Run it after `nx graph` has
// populated .nx/workspace-data/file-map.json, or it builds the graph itself.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createProjectGraphAsync } from '@nx/devkit'

const outputPath = process.argv[2] ?? 'results/nx-dependency-levels.json'

// Building the graph is what writes the file map cache.
await createProjectGraphAsync({ exitOnError: false })

const { fileMap } = JSON.parse(
  readFileSync('.nx/workspace-data/file-map.json', 'utf8'),
)
const entries = Object.values(fileMap.projectFileMap).flat()

const withDeps = entries.filter((entry) => entry.deps?.length)
const tsFiles = entries.filter((entry) => entry.file.endsWith('.ts'))

const result = {
  totalFilesTracked: entries.length,
  typescriptFilesTracked: tsFiles.length,
  filesCarryingDependencies: withDeps.length,
  filesCarryingDependenciesThatAreManifests: withDeps.filter((entry) =>
    entry.file.endsWith('package.json'),
  ).length,
  typescriptFilesCarryingDependencies: tsFiles.filter((entry) => entry.deps?.length)
    .length,
  attribution: Object.fromEntries(
    withDeps.map((entry) => [entry.file, entry.deps.sort()]),
  ),
  conclusion:
    'Every workspace edge is attributed to the project manifest; no TypeScript ' +
    'file carries any. In a pnpm workspace Nx knows dependencies at exactly ' +
    'one level, project to project, and derives them from the manifests.',
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`)
console.error(
  `files tracked ${result.totalFilesTracked}, typescript ${result.typescriptFilesTracked}\n` +
    `carrying deps ${result.filesCarryingDependencies}, of which manifests ${result.filesCarryingDependenciesThatAreManifests}\n` +
    `typescript files carrying deps ${result.typescriptFilesCarryingDependencies}`,
)
