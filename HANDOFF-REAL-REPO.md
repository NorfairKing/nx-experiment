# Handoff: applying this to the real repository

You have the actual Nx + pnpm + Vitest monorepo in front of you. This experiment
answered the design question on a 19-project stand-in; your job is to apply the
answer, and the first thing to establish is whether the answer applies at all.

Read in this order: this file, then [PLAN.md](PLAN.md) for the build order, then
[FINDINGS.md](FINDINGS.md) when you need to know *why* something is shaped the
way it is. [docs/nix-without-nx.html](docs/nix-without-nx.html) is the same
evidence as a page you can open in a browser.

## Start here: two commands decide the architecture

Do not write any Nix until these are answered. They take minutes and they
determine which of two designs you are building.

```bash
pnpm install                      # the checks below need node_modules to exist

# 1. Does an undeclared import resolve? It must NOT.
cd packages/<any-package>
node -e "require.resolve('@scope/<a-workspace-package-it-does-not-declare>')"
#    want: MODULE_NOT_FOUND, exit 1
#    then repeat with a package the manifest DOES declare — it must print a
#    path, or the check is not discriminating and tells you nothing

# 2. Does any tsconfig path mapping cross a project boundary?
grep -rn '"paths"' tsconfig*.json */*/tsconfig.json
#    want: no output. grep exits 1, which means "found nothing", not "failed".
#    If there is output, read each mapping: one pointing at ./src/* is harmless,
#    one pointing into another project is not.
```

**Both pass** — an undeclared import fails to resolve, and no mapping crosses a
boundary. Then the manifests *are* the dependency graph, you need nothing from
Nx, and you are building **architecture A**. This was the case in the
experiment.

**Either fails** — the manifests under-report the real edges, silently. You are
building **architecture C**: Nx computes the graph offline, you commit the
result, and Nix reads that instead. `nix/graph.nix` in the experiment already
supports this: drop a table at `nix/projects.json` and it uses it, no other
change. `scripts/nx-to-nix.mjs` generates one from `nx graph --file`.

Do not use `pnpm config get node-linker` for check 1. It prints `undefined` in
the normal passing case, so the answer looks like an error while telling you
nothing about the tree that actually got installed.

The five remaining preconditions — tests importing source rather than built
output, one real build and test target per project, `tsc` as the builder, no
uncommitted generated sources, and whether a post-build hook uploads to a cache
— are in FINDINGS.md § *Preconditions*, each with a command whose real output is
shown.

## Established, with evidence. Do not re-derive.

Every number below is backed by a committed file in `results/`, named in
FINDINGS.md beside the claim.

- **Nx knows dependencies at exactly one level** — project to project — and
  derives them from the manifests. Of the 126 files in its file map, 16 carry
  dependency information and all 16 are `package.json`; none of the 88
  TypeScript files carries any. The per-file `deps` field exists in the schema
  and is empty.
- **Deriving the graph in the Nix evaluator produces byte-identical
  derivations** to the generated table it replaced — all 38 — at the same
  evaluation cost. No IFD, no checked-in file.
- **Evaluation does not grow meaningfully with the workspace**: 98 ms at 24
  projects, 143 ms at 389, with every derivation forced. 28× the source bytes
  costs 9%.
- **Per package is the granularity frontier.** Per-test-file improves
  invalidation from 14/19 to 22/27 — proportionally worse — and introduces a way
  to skip tests silently.
- **Nix is faster than Nx on aggregate work** once evaluation is amortised:
  156 ms per unit against 341 ms. It loses only on building a single unit,
  1 177 ms against 845 ms, and 816 ms of that is evaluation.
- **Architecture D — deriving from Nx's task graph — is measured and rejected.**
  It generates 5 fewer units (the leaf projects nothing depends on, which is
  exactly what typechecks them) and 3 spurious edges.

## The recipe, in the order the pieces bite

PLAN.md has this in full, rebuilt from scratch against a fresh workspace to find
its gaps. The shape:

1. **Project discovery.** Nix has no YAML parser, so restate the
   `pnpm-workspace.yaml` globs in Nix and `readDir` them. That restatement is
   the one thing taken on trust — guard 1 below exists for it.
2. **The dependency closure.** `pnpm.fetchDeps`, `fetcherVersion = 4`, `src`
   reduced to manifests and lockfile only. Reduce each manifest **in the
   evaluator** with `builtins.toFile`, keeping name, version and the dependency
   fields. A build step doing the same stripping does not work — it still takes
   the full manifests as its own input. `fetchDeps` needs a hash you cannot know
   in advance: set `lib.fakeHash`, build, copy the `got:` value.
3. **The install.** One derivation, `pnpm` and `pnpm.configHook` in
   `nativeBuildInputs`, output = manifest skeleton *plus* `node_modules`. They
   are not separable; pnpm's `node_modules` links back into the workspace dirs.
4. **The working tree each derivation builds inside.** The piece with no obvious
   shape: a `node_modules` symlink at the workspace root, plus per-project
   `node_modules` holding each dependency's store path under its real package
   name. `tsc` and `vitest` come from `$PWD/node_modules/.bin`.
5. **Build derivation.** `tsc -p tsconfig.json`; output carries its own
   `node_modules` so it is a self-contained closure; delete positional artifacts
   (`.d.ts.map`, source maps).
6. **Test derivation.** `vitest run` with `set -o pipefail`. Does not need the
   package's own build. Links dev dependencies, which the build does not.

Filesets are where the granularity comes from: **precise for the build**,
because a tsconfig declares what `tsc` reads; **the whole project directory for
the test**, because a Vitest config is a program that can pull in setup files
and fixtures from anywhere. Split the workspace-root files by tool — handing the
shared Vitest config to `tsc` rebuilds every compilation for nothing.

Recover the dev/runtime split from the manifest *sections*, not from Nx's graph,
which reports both as `type: "static"`.

## Non-negotiable: three guards

A graph Nix inferred is an inference, and a wrong inference fails one way only:
fewer tests, still green. All three belong in `nix flake check`.

| Question | Authority |
|---|---|
| Is every project present? | `pnpm list -r --depth -1 --json` |
| Are the declared edges the ones the source imports? | `nix build` of every package; pnpm-strict resolution makes an undeclared import a hard error |
| Is every test file covered? | `vitest list --filesOnly --json`, only if you go per-test-file |

Prove each one by breaking it deliberately before you trust it. In the
experiment, dropping `apps` from the workspace globs silently took the test
derivations from 19 to 16.

**The second row is not optional and the reason is easy to miss: Vitest does not
typecheck.** Vite strips types without checking them, and a package's test does
not depend on its own build. Combine those and a type error in a leaf package
with no dependants is invisible to every check in the flake.

## Traps that cost real time here

- **Measure with `--option post-build-hook ""`.** If the machine uploads outputs
  to a binary cache, that costs roughly 1.8 s *per derivation* and will swamp
  everything you measure. It also means fine granularity costs real money in a
  cache-pushing setup — count derivations.
- **Never force a cold build by deleting from the store.** `nix store delete`
  scans every GC root then walks `/nix/store/.links`; on a large deduplicated
  store, called per path, it took this machine down. Force work by changing an
  input instead — editing the shared Vitest config invalidates every test
  derivation and no build derivation.
- **`keep-outputs = true` makes "delete then rebuild" silently do nothing.** An
  output stays alive while its derivation is alive, so the deletion is refused
  and the "cold" run is a cache lookup.
- **Make every harness mutation unique per run.** Appending identical text
  reproduces derivations an earlier run already built, and you measure the
  cache. This produced a published claim that was wrong by an order of magnitude
  in the wrong direction.
- **Check that a field is populated, not just present.** A day went into
  designing a bridge for Nx's per-file dependency data before one `jq` query
  showed it empty.

## What not to bother with

- **`nx affected` at build time.** Project-level, coarser than Nx's own task
  hashing, and redundant once the graph is in Nix.
- **Sharing a workspace skeleton between derivations.** Measured: it could
  recover 69 ms of 1 177 ms, and only by making the package sources an input to
  every test.
- **Content-addressed derivations**, unless the daemon has `ca-derivations`
  enabled. Worth doing the prerequisite anyway — deleting positional artifacts
  from build outputs — because it is free and correct on its own.
- **Per-test-file granularity by default.** Reach for it only where one
  package's test files are *unevenly* slow, so the slow ones stop queueing.

## Done looks like

1. `nix flake check` green, including a build derivation per package and all
   three guards.
2. Each guard demonstrated to fail when you break what it protects.
3. `nix eval --option allow-import-from-derivation false` succeeds over every
   flake output — no IFD crept in.
4. The change matrix re-run on the real repo, so you know what each class of
   change actually invalidates there rather than here.

## Still open, and which of it is yours

- **The preconditions above.** Yours, and first. Everything else is conditional
  on them.
- **Deep cross-package import graphs and `tsconfig` project references.** The
  scaling workspace was layered but shallow. If the real repo has deep chains or
  project references, re-measure evaluation.
- **The single-unit gap.** 1 177 ms against 845 ms, mostly evaluation. Only
  bites a loop that builds one package at a time. Whether Nix can be invoked
  once and told to watch is unexplored, and is the obvious next thing if the
  inner loop annoys anyone.
- **Content-addressed derivations.** Blocked on daemon configuration, not on
  design.
- **Architecture D for projects with several real targets.** Rejected for one
  build and one test target per project; untested beyond that.
