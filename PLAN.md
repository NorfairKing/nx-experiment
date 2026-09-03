# Plan: a flake for the real repository

What to do when you get your hands on the actual Nx + pnpm + Vitest monorepo.
The evidence behind every choice here is in [FINDINGS.md](FINDINGS.md); this is
the order to do things in.

The original ask had three criteria. Where they landed:

| criterion | result |
|---|---|
| avoids IFD if possible | **yes, for free** — the graph is derived in the evaluator; verified with `allow-import-from-derivation false` |
| evaluates quickly | **yes** — **143 ms at 389 projects**, 16× the projects for 1.5× the time |
| maximises granularity of rebuilds | **per package is the frontier** — per-test-file barely improves invalidation (22/27 vs 14/19) and adds a hazard |

## Phase 0 — check the preconditions first

Half a day, and it decides the architecture. FINDINGS.md has the full list with
consequences; the two that matter most:

```bash
# Does an undeclared import resolve? It must not.
cd packages/<any-package> && node -e "require.resolve('@scope/<not-a-dependency>')"
#   want: MODULE_NOT_FOUND, exit 1
#   `pnpm config get node-linker` is not the check: it prints `undefined` in
#   the normal passing case, so the answer looks like an error.

# Does any tsconfig path mapping cross a project boundary?
grep -rn '"paths"' tsconfig*.json */*/tsconfig.json
#   want: no output (grep exits 1, which means "found nothing")
```

Note that the resolution check needs `pnpm install` to have run: with no
`node_modules` nothing resolves, so the control case cannot pass and the check
tells you nothing.

If an undeclared import fails to resolve and no path mapping crosses a project
boundary, the manifests are the graph and you need no Nx at all. If either fails, Nx's
analysis is load-bearing: generate a table with `scripts/nx-to-nix.mjs` and
drop it at `nix/projects.json`, which `nix/graph.nix` picks up automatically.

Also worth knowing before you start:

```bash
nix config show post-build-hook        # if set, it charges ~1.8 s per derivation
nx show project <some-project> --json | jq '.targets | keys'
```

And confirm the lockfile is current, because everything downstream is derived
from it:

```bash
pnpm install --frozen-lockfile   # must succeed; if it does not, the lockfile
                                 # disagrees with the manifests and the Nix
                                 # install will fail the same way
```

## Phase 1 — get one package's tests building

Do not start with the graph. Start with a single package, hand-written, and get
`nix build .#test-<pkg>` green. Everything else is generalisation.

Everything below was rebuilt from this section alone against a fresh
ten-project workspace with no Nix in it, which is how the gaps that used to be
here were found. What follows is what you actually need.

**Project discovery, before any of it.** Nix has no YAML parser, so it cannot
read `pnpm-workspace.yaml`. Restate the globs in Nix and `builtins.readDir`
them:

```nix
dirsIn = parent: lib.attrNames (lib.filterAttrs (_: t: t == "directory")
  (builtins.readDir (repoRoot + "/${parent}")));
projectRoots = map (n: "packages/${n}") (dirsIn "packages")
            ++ map (n: "apps/${n}") (dirsIn "apps");
```

That restatement is the one thing taken on trust, which is why Phase 3 has a
guard comparing it against pnpm's own answer.

The pieces, in the order they bite:

1. **The dependency closure.** `pnpm.fetchDeps` with `fetcherVersion = 4`, and
   its `src` reduced to the manifests and the lockfile — nothing else, or every
   source edit refetches. Reduce each manifest **in the evaluator** with
   `builtins.toFile`, keeping only `name`, `version`, and the dependency
   fields. A build step doing the same stripping does not work: it still takes
   the full manifests as its own input. This one trick took a manifest edit
   from invalidating every test to invalidating one.

   `fetchDeps` is a fixed-output derivation, so it needs a hash you cannot know
   in advance. Set `hash = lib.fakeHash;`, build, and copy the `got:` value out
   of the mismatch error. Expect to redo this whenever the lockfile changes.
2. **The install.** One derivation with `pnpm` and `pnpm.configHook` in
   `nativeBuildInputs` — the hook is what actually runs the offline install —
   and output = the manifest skeleton *plus* `node_modules`. pnpm's
   `node_modules` links back into the workspace package directories, so the two
   are not separable; output only `node_modules` and stdenv's
   `noBrokenSymlinks` check will reject it.
3. **The working tree each derivation builds inside.** This is the piece with
   no obvious shape, and getting it wrong is what makes everything else look
   impossible. A derivation's source is the workspace *layout*, and around it
   you need:

   ```sh
   ln -s ${nodeModules}/node_modules ./node_modules   # at the workspace root
   # and, per project, its dependencies as store paths under their real names
   mkdir -p "$(dirname ${project.root}/node_modules/${dep.name})"
   ln -sfn ${builds.${dep}} ${project.root}/node_modules/${dep.name}
   ```

   Link dependencies under their **real package name**, scope included, so
   nothing assumes a particular npm scope. `tsc` and `vitest` then come from
   `$PWD/node_modules/.bin` before you `cd` into the project.
4. **The build derivation.** `tsc -p tsconfig.json`, output `$out/package.json`
   + `$out/dist`. Then the part everyone gets wrong: **give the output its own
   `node_modules`** with symlinks to its dependencies' store paths. Node
   resolves a bare specifier by walking up from the importing file, and nothing
   walks up from a store path. Also delete positional artifacts — `.d.ts.map`,
   source maps — because nothing downstream reads them and they are the only
   reason `tsc` output changes under a formatting edit.
5. **The test derivation.** `vitest run`, with `set -o pipefail` if you pipe
   through `tee`, or a failing test yields a *successful* derivation. It does
   **not** need the package's own build: the tests import `src` directly. Its
   dependency links include the **dev** dependencies, which the build's do not.

## Phase 2 — the filesets, which is where the granularity comes from

| derivation | inputs | why |
|---|---|---|
| install | reduced manifests, lockfile, workspace file | pnpm reads nothing else |
| build | `src/`, `package.json`, `tsconfig.json`, root tsconfig | a tsconfig *declares* what `tsc` reads |
| test | the **whole project directory**, root tsconfig, shared vitest config | a Vitest config is a *program* — it can pull in setup files and fixtures from anywhere |

Split the workspace-root files by tool. Every tsconfig extends the base
tsconfig and every Vitest config merges the shared one, but neither tool reads
the other's file. Handing both to both means a Vitest-config edit rebuilds
every `tsc` output — which this repo did, until it was measured.

Recover the **dev/runtime dependency split from the manifest sections**, not
from Nx's graph, which reports both as `type: "static"`. A test-only package
should be an edge of the test derivation and not the build derivation. It
halves the affected set: 4 rather than 8 here.

## Phase 3 — the guards, before you trust any of it

A graph Nix inferred is an inference, and a wrong inference is silent: fewer
tests, still green. Three checks, because the question has three parts.

| question | check |
|---|---|
| is every project present? | Nix's project list against `pnpm list -r --depth -1 --json` |
| are the declared edges the ones the source imports? | `nix build` of every package — pnpm-strict resolution makes an undeclared import a hard error |
| is every test file covered? | `vitest list --filesOnly --json` against the enumeration, *only if* you use per-test-file derivations |

All of them belong in `nix flake check`. Two non-obvious reasons:

- **Vitest does not typecheck.** Vite strips types without checking them, and a
  package's test does not depend on its own build. Without the build
  derivations in the check set, a type error in a leaf package is invisible to
  everything.
- Nix cannot read `pnpm-workspace.yaml` — no YAML parser — so the workspace
  globs get restated in Nix. That restatement is the one thing taken on trust,
  which is why pnpm checks it.

Prove each guard catches what it is for by breaking it deliberately. Every
guard in this repo was demonstrated that way, and the demonstration is how one
of them was found not to work.

## Phase 4 — granularity, and when to stop

**Stop at one build and one test derivation per package.** Going per-test-file
improves invalidation from 14/19 to 22/27 — proportionally *worse* — for a
wall-clock cost too small to measure reliably (two runs gave +18% and +2%). It
also introduces the enumeration hazard. The gain is not there.

Reach for per-file only where a package's test files are *unevenly* slow, so
the slow ones stop queueing behind the fast ones. If you do, take the file list
from Nx's atomizer (`test-ci--<file>` target names in `nx graph --file`), keep
the enumeration guard, and count derivations against any post-build hook.

Nx will refuse to *run* the atomizer's group target without Nx Cloud. The
individual per-file targets run locally, and so does anything Nix does with the
list — which is the one place in this whole exercise where Nx has something
worth taking.

## Phase 5 — measure on the real thing

The numbers in FINDINGS.md are from a 19-project hand-written workspace and a
synthetic 400-project one. On the real repo, re-run:

```bash
node scripts/change-matrix.mjs     # what each class of change invalidates
node scripts/benchmark.mjs         # cost, with the upload hook disabled
node scripts/measure-scale.mjs     # if project count is much over 400
```

Two traps that cost real time here, both now guarded in the scripts: measure
with `--option post-build-hook ""` or you are measuring your cache upload, and
make each harness mutation unique per run or you are measuring cache hits.

## What not to bother with

- **`nx affected` at build time.** Project-level, coarser than Nx's own task
  hashing, and redundant once the graph is in Nix.
- **Sharing a workspace skeleton between derivations.** Examined and rejected
  on measurement: the skeleton is not the expensive part, and a shared
  derivation holding the sources becomes an input to every test.
- **Content-addressed derivations**, unless your daemon has `ca-derivations`
  enabled. The prerequisite — deleting positional artifacts — is worth doing
  anyway.
