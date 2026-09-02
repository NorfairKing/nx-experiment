# nx-experiment

Can Nix take advantage of the dependency analysis Nx has already done on a
JavaScript monorepo, and build and test that repository at a finer granularity
than "run everything when anything changes"?

Conclusions are in [FINDINGS.md](FINDINGS.md). This file is how to reproduce
them.

## The workspace

19 projects: 16 packages and 3 apps, a small arithmetic language plus some
foundation libraries. The shape matters more than the code:

```
                        core
        ┌─────────┬───────┼────────┬──────────┐
     strings  collections logging tokens  test-utils
        │         │        │      │  │         │ (dev only)
        │         └──┐     │   ┌──┘  └──┐      │
        └──────────┐ │     │   │        │      │
                  lexer   ast  │        │      │
                     └──┬───┘  │        │      │
                      parser ──┘        │      │
                         └───► compiler │      │
                                  ├───► runtime│
                                  │        ├──► cli
                                  │        └──► web
                                  └──────────►  report

chain-d ──► chain-c ──► chain-b ──► chain-a        orphan
```

- `core` is the heavily shared foundation: five direct dependants, fourteen
  transitive.
- `tokens` → {`lexer`, `ast`} → `parser` is a diamond, with a direct
  `parser` → `tokens` chord.
- `compiler` and `runtime` are fan-ins.
- `chain-a..d` is an isolated four-deep line, so a change at the bottom affects
  exactly four projects and nothing else.
- `orphan` has no dependencies and no dependants.
- `test-utils` is a **dev** dependency of `lexer`, `parser` and `runtime`. It is
  the case where the two dependency models disagree.

Tests are real computations with real assertions, 129 of them across 27 files,
deliberately uneven in cost (`lexer/tests/throughput.test.ts` and
`runtime/tests/agreement.test.ts` are the slow ones).

## Getting a shell

Node and pnpm come from the flake; nothing is needed on the host but Nix.

```bash
nix develop
pnpm install
```

## The three prototypes

All of them read `nix/graph.nix`, which derives the project graph from the
workspace manifests during evaluation — no Nx, no generated file, no
import-from-derivation.

```bash
# Prototype 1 and 2: one derivation per package.
nix build .#test-core .#test-runtime      # one package's tests
nix build .#build-parser                  # one package's tsc output
nix build .#allTests                      # every package's tests

# Prototype 3: one derivation per test file, two input granularities.
nix build .#file-core--tests-hash-test-ts     # whole tests/ as input
nix build .#narrow-core--tests-hash-test-ts   # only that file as input

# The guards. `guard-<project>` checks that the per-test-file enumeration still
# matches what Vitest itself discovers; `workspaceProjects` checks that the
# workspace globs Nix restates still match what pnpm resolves.
nix build .#guard-core
nix build .#workspaceProjects
```

`nix flake check` builds every per-package test and every guard.

To see that Nix's dependency edges really are Nx's:

```bash
nix-store -q --references $(nix build .#build-parser --no-link --print-out-paths) \
  | grep -o 'nx-exp-[a-z-]*-dist'
# ast, lexer, tokens — exactly parser's runtime dependencies, and not test-utils
```

## The graph, and the optional bridge

The project graph is derived during evaluation from the workspace manifests, so
there is nothing to regenerate and nothing checked in. `nix/graph.nix` is the
whole mechanism.

It works because pnpm's isolated linking makes an undeclared import a hard
build error rather than a missing edge, so the manifests *are* the graph. If
that stops being true — a hoisted `node_modules`, or edges coming from
`tsconfig` path aliases — generate a table from Nx and drop it in place:

```bash
nx graph --file=results/nx-graph-export.json   # Nx's documented export
node scripts/nx-to-nix.mjs                     # writes nix/projects.json
```

`nix/graph.nix` picks that file up automatically if it exists, with no other
change. Both routes produce byte-identical derivations, which is how they were
shown to be equivalent.

Three checks protect the inference, because it can fail silently — fewer tests,
still green:

```bash
nix build .#workspaceProjects   # Nix's project list vs what pnpm resolves
nix build .#build-core          # an import no manifest declares fails here
nix build .#guard-core          # a test file Vitest runs with no derivation
```

## The experiments

Each writes machine-readable output to `results/`. They mutate tracked files and
restore them, so the working tree must be clean before running one.

```bash
node scripts/change-matrix.mjs        # results/change-matrix.json
node scripts/granularity.mjs          # results/granularity.json
node scripts/benchmark.mjs            # results/benchmark.json
node scripts/input-comparison.mjs     # results/input-comparison.json
node scripts/correctness-probes.mjs   # results/correctness-probes.json
node scripts/measure-scale.mjs        # results/scale.json
node scripts/nx-dependency-levels.mjs # results/nx-dependency-levels.json
node scripts/dump-nx-hashes.mjs       # Nx task hashes, to stdout
```

- **change-matrix** applies 13 classes of change and records, for each, which
  projects Nx reports affected, which Nx task hashes changed, and which Nix
  derivation paths changed. This is the main result.
- **granularity** measures node count, evaluation time and invalidation at each
  of the three granularity levels.
- **benchmark** times the cached case, one unit of work, a rebuild after a
  shared-source edit, and a rebuild of every unit at each granularity, against
  the Nx baseline. It never deletes from the store: an earlier version measured
  cold builds that way, and `nix store delete` runs a `/nix/store/.links` pass
  that took the machine down on a store deduplicating a couple of hundred
  gigabytes. Instead it edits `vitest.shared.ts`, which invalidates every test
  derivation and no build derivation. The script says so in a comment; please
  leave it that way.

  It also passes `--option post-build-hook ""`. This machine uploads every
  output to a shared binary cache, which costs roughly 2 s per derivation and
  swamped every Nix figure in FINDINGS.md until it was disabled.
- **measure-scale** generates synthetic workspaces from 25 to 400 projects and
  times evaluation with every derivation forced. This is the measurement that
  decided the architecture holds at size.
- **nx-dependency-levels** counts where Nx's file map actually carries
  dependency information. The answer is: only on `package.json`.
- **correctness-probes** deliberately breaks four things — an undeclared
  import, a type error no test exercises, a cross-package `tsconfig` `paths`
  alias, an uncommitted generated source — and records which mechanism notices
  each.
- **input-comparison** classifies every file in the repository as an input to a
  given package's test according to Nx, according to Nix, and according to what
  should actually affect it.

A convenient table from the matrix:

```bash
jq -r '["change","nxAffected","nxRehashed","nixInvalidated"],
       (.changes[] | [.id, (.nx.affectedTestProjects|length),
                      (.nx.rehashedTestTasks|length),
                      (.nix.invalidatedTests|length)]) | @tsv' \
  results/change-matrix.json | column -t
```

## Feedback loops

In increasing cost:

1. `nix build .#test-core` — one package's tests under Nix, a few seconds.
2. `pnpm exec nx run-many -t test` — every test through Nx.
3. `nix build .#allTests` — every test through Nix, each isolated.
4. `nix flake check` — the formatters, every per-package test, every guard.
   Every change must pass this.

The experiment harnesses are not part of `nix flake check`: they mutate the
working tree and take minutes.

## Layout

```
packages/, apps/          the workspace
nx.json                   named inputs, target defaults, the @nx/vitest plugin
nix/workspace.nix         pnpm dependency closure and the install
nix/support.nix           machinery shared by the prototypes
nix/per-package.nix       prototype 1 and 2
nix/per-test-file.nix     prototype 3, plus the enumeration guards
nix/graph.nix             the project graph, derived from the manifests
nix/graph-guard.nix       the check that Nix's project list matches pnpm's
scripts/                  graph export, the bridge, and the four experiments
results/                  measurements
FINDINGS.md               what it all means
```

## A note on scope

The brief this came from asked for 50–300 packages. This is 19, deliberately:
the questions being answered are about the two dependency models, and at 19
projects every number in `results/` can be checked by hand. Evaluation cost at
hundreds of packages and thousands of derivations is the main thing that scale
would tell us, and it is listed as an open question in FINDINGS.md.

NixCI is not involved in any of the above, per the brief.
