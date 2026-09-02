// Checks the project list Nix derived against the one pnpm resolves.
//
// Nix cannot read pnpm-workspace.yaml: it has no YAML parser, so nix/graph.nix
// restates the workspace globs. If those drift from the real ones, a project
// silently gets no derivations at all and nothing else notices — the same
// silent under-selection this repo guards against everywhere else, relocated
// to the one file Nix has to take on trust.
//
// pnpm is the authority here, and an independent one: it reads
// pnpm-workspace.yaml itself and resolves the globs its own way. The source
// tree this runs against contains *every* package.json in the repository, not
// only those under Nix's globs, so pnpm can find projects Nix missed.
//
// $expectedRoots holds Nix's list, newline-separated.
import { execFileSync } from 'node:child_process'

const expected = (process.env.expectedRoots ?? '')
  .split('\n')
  .filter(Boolean)
  .sort()

const listed = JSON.parse(
  execFileSync('pnpm', ['list', '--recursive', '--depth', '-1', '--json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }),
)

const root = process.cwd()
const actual = listed
  .map((entry) => entry.path)
  // The workspace root is a pnpm project but not one of ours.
  .filter((path) => path !== root)
  .map((path) => path.slice(root.length + 1))
  .sort()

const missing = actual.filter((project) => !expected.includes(project))
const extra = expected.filter((project) => !actual.includes(project))

if (missing.length > 0 || extra.length > 0) {
  console.error('the project list Nix derived disagrees with pnpm')
  if (missing.length > 0) {
    console.error(
      `  pnpm manages these, Nix generates no derivations for them: ${missing.join(', ')}`,
    )
    console.error("  the workspace globs in nix/graph.nix are probably out of date")
  }
  if (extra.length > 0) {
    console.error(`  Nix expects these, pnpm does not manage them: ${extra.join(', ')}`)
  }
  process.exit(1)
}

console.log(`workspace agrees: ${actual.length} projects`)
