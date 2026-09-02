// Rebuilds the project table from the workspace manifests alone and fails when
// it disagrees with the checked-in nix/projects.json.
//
// Run inside the guard derivation in nix/graph-guard.nix, against a source tree
// containing only the reduced manifests. Projects are discovered by globbing
// that tree, not read from any list carried over from the table being checked:
// a guard generated from the same source as its data proves only that the
// generator is deterministic.
//
// The table to check arrives as JSON in $expected.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const expected = JSON.parse(process.env.expected)

// Discover projects the way pnpm does: the workspace globs, not a list
// carried over from the thing being checked.
const parents = ['packages', 'apps']
const manifests = new Map()
for (const parent of parents) {
  if (!existsSync(parent)) continue
  for (const entry of readdirSync(parent)) {
    const manifestPath = join(parent, entry, 'package.json')
    if (!existsSync(manifestPath)) continue
    manifests.set(
      join(parent, entry),
      JSON.parse(readFileSync(manifestPath, 'utf8')),
    )
  }
}

const workspaceNames = new Set([...manifests.values()].map((m) => m.name))
const attrOf = (name) => name.replace(/^@[^/]+\//, "")

const workspaceDeps = (record) =>
  Object.keys(record ?? {})
    .filter((dep) => workspaceNames.has(dep))
    .map(attrOf)
    .sort()

const actual = {}
for (const [root, manifest] of manifests) {
  actual[attrOf(manifest.name)] = {
    name: manifest.name,
    root,
    runtimeDeps: workspaceDeps(manifest.dependencies),
    devDeps: workspaceDeps(manifest.devDependencies),
  }
}

const problems = []

const expectedAttrs = Object.keys(expected).sort()
const actualAttrs = Object.keys(actual).sort()

for (const attr of actualAttrs) {
  if (!(attr in expected)) {
    problems.push(
      `${attr} (${actual[attr].root}) is a workspace project with no entry in nix/projects.json, so no derivation is generated for it and its tests never run`,
    )
  }
}
for (const attr of expectedAttrs) {
  if (!(attr in actual)) {
    problems.push(
      `${attr} has an entry in nix/projects.json but is not a workspace project any more`,
    )
  }
}

const sameList = (left, right) =>
  left.length === right.length && left.every((item, i) => item === right[i])

for (const attr of expectedAttrs) {
  if (!(attr in actual)) continue
  const want = actual[attr]
  const have = expected[attr]
  if (have.name !== want.name) {
    problems.push(`${attr}: name is ${want.name}, nix/projects.json says ${have.name}`)
  }
  if (have.root !== want.root) {
    problems.push(`${attr}: root is ${want.root}, nix/projects.json says ${have.root}`)
  }
  if (!sameList(have.runtimeDeps, want.runtimeDeps)) {
    problems.push(
      `${attr}: dependencies are [${want.runtimeDeps}], nix/projects.json says [${have.runtimeDeps}]`,
    )
  }
  if (!sameList(have.devDeps, want.devDeps)) {
    problems.push(
      `${attr}: devDependencies are [${want.devDeps}], nix/projects.json says [${have.devDeps}]`,
    )
  }
}

if (problems.length > 0) {
  console.error('nix/projects.json disagrees with the workspace manifests:')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('')
  console.error('Regenerate it:')
  console.error('  nx graph --file=results/nx-graph-export.json')
  console.error('  node scripts/nx-to-nix.mjs')
  process.exit(1)
}

console.log(
  `graph agrees: ${actualAttrs.length} projects, ` +
    `${actualAttrs.reduce((n, a) => n + actual[a].runtimeDeps.length + actual[a].devDeps.length, 0)} edges`,
)
