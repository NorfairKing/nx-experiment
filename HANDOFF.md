# Handoff

State of this experiment, and what to do next. Written so a cold session can
pick it up without re-deriving anything. Conclusions live in
[FINDINGS.md](FINDINGS.md); how to run things is in [README.md](README.md).

## Read this first: safety

**A previous session crashed this machine.** The cause was
`scripts/benchmark.mjs` calling `nix store delete` once per output path,
seventy-odd times per run, twice over, while Nix built in parallel. Each such
call scans every GC root and then runs a "deleting unused links" pass over
`/nix/store/.links`. This machine's store deduplicates over 200 GiB.

Therefore:

- **Never** run `nix store delete`, `nix store gc`, `nix store optimise`,
  `nix-collect-garbage`, or anything else that walks or mutates the shared
  store. `scripts/benchmark.mjs` carries a comment saying why the deletion was
  removed; leave it removed.
- Cap parallelism on every build: `--max-jobs 4`. Never run two build-heavy
  things at once.
- `df -h` before writing anything large. (At time of writing: 2.7 T free.)
- Prefer eval-only or `--dry-run` measurements. Most of the interesting
  questions here are answerable without building.

**Always pass `--option post-build-hook ""` when measuring.** This machine
uploads every output to a shared binary cache, which costs roughly 2 s per
derivation and swamped every Nix figure in this experiment until it was
disabled. It is deployment policy, not part of the question.

## Where things stand

`nix flake check` passes: 59 checks — 19 per-package Vitest derivations, 19
per-package `tsc` derivations, 19 test-file enumeration guards, the
graph-agreement guard, and the formatters. Working tree clean.

**The commits are pushed to master.** That was authorised late in the
experiment; CI is the feedback loop that matters.

The workspace is 19 projects (16 packages, 3 apps), 27 test files, 129
assertions, hand-written and shaped for the dependency cases: a heavily shared
foundation (`core`), a diamond with a chord (`tokens` → {`lexer`, `ast`} →
`parser`, plus `parser` → `tokens`), fan-ins (`compiler`, `runtime`), an
isolated four-deep chain (`chain-d..a`), an orphan, and `test-utils` as a
dev-only dependency of three packages.

Scale was deferred deliberately by the user: theory first, hand-written
packages, no generator. That deferral is now spent — see the plan below.

## Established findings: do not re-derive these

All numbers are backed by committed `results/`. If you change something that
moves a number, update the prose that cites it.

**The verdict.** Architecture A: Nix alone. For a pnpm workspace with isolated
linking, Nx is not needed at all — not even offline. Per-package granularity,
with per-test-file only where one package's test files are unevenly slow.

**Nx knows dependencies at exactly one level**, project to project, derived
from the manifests. `results/nx-dependency-levels.json`: of 126 tracked files,
16 carry dependency information and all 16 are `package.json`; none of the 88
TypeScript files carries any. `nix/graph.nix` derives the same graph during
evaluation and produces byte-identical derivation paths at the same evaluation
cost.

**The bridge survives as an optional override**, for a workspace where the
manifests stop being the graph. `scripts/nx-to-nix.mjs` (69 lines, no Nx
internals) writes a table to `nix/projects.json`, which `nix/graph.nix` picks
up if present. (`scripts/dump-nx.mjs` does reach into `nx/src/...` internals,
but only to measure Nx's task hashes for the comparison; nothing built depends
on it.)

**Evaluation is flat in project count.** 107 ms at 24 projects, 148 ms at 389,
with all derivations forced. Criterion 2 is satisfied to at least 400 projects.

**The two models agree on 11 of 13 change classes.** Both divergences favour
Nix: a dev-only dependency edge (Nix 4, Nx 8 — Nx's graph reports
`dependencies` and `devDependencies` both as `type: "static"`, so `^sources`
propagates test-only packages into build inputs), and `pnpm-workspace.yaml`
(Nix 19, Nx 0 — it is in no named input).

**Compare Nx task hashes, not `nx show projects --affected`.** Affectedness is
project-level and ignores target inputs; the hash is what Nx actually reuses.
Comparing affectedness to Nix invalidation flatters Nix.

**Nx's atomizer is Cloud-gated at the group target only.** `nx run
pkg:test-ci` refuses without Nx Cloud; the individual
`test-ci--tests/foo.test.ts` targets run locally. This is the clearest case of
Nx holding information another executor can act on.

**Nx's default glob test discovery honours `.gitignore`.** A gitignored but
present test file gets no atomized target while `vitest run` still runs it.
The repo sets `discoverTestFiles: "vitest"`. A Nix repo is unusually exposed,
because `result` is what `nix build` symlinks to.

**A tsconfig is a manifest; a Vitest config is a program.** `tsc` states its
inputs, so build filesets are precise. A Vitest config can read setup files and
fixtures from anywhere under the project, so test derivations take the whole
project directory. Guessing broke a derivation the first time it was tested.

**Vitest does not typecheck.** Vite strips types without checking them, and
`test-X` deliberately does not depend on `build-X`. So without the build
derivations in `checks`, a type error in a leaf package is invisible to
everything.

**A build output must carry its own `node_modules`.** Node resolves a bare
specifier by walking up from the importing file, and nothing walks up from a
store path. Once each output carries `node_modules/@nx-exp/<dep>` symlinks,
`nix-store -q --references` reproduces the package graph exactly.

**Reduce inputs in the evaluator, not in a build step.** Stripping each
`package.json` to the fields pnpm resolves against and emitting it with
`builtins.toFile` took a manifest edit from invalidating 19/19 test derivations
to 1/19. A build step doing the same stripping would not work: it still takes
the full manifests as its own input.

**Cost, hook disabled, `--max-jobs 4`** (`results/benchmark.json`). Nix wins
almost everywhere: 75 ms to establish everything is current against Nx's
458 ms; 3.76 s to rerun what a shared-foundation edit invalidates against
6.38 s; 156 ms per unit of work with evaluation amortised against 341 ms. It
loses only on building a *single* unit, 1.18 s against 0.85 s, and 816 ms of
that is one invocation's evaluation. With the upload hook that same unit costs
3.02 s.

**Evaluation dominates the per-unit cost and is flat in workspace size.** Of
1177 ms for one leaf test derivation: 816 ms evaluation, 292 ms Vitest, 69 ms
stdenv and tree assembly. Evaluation goes 107 ms at 24 projects to 148 ms at
389, so it is a fixed cost per invocation rather than per project.

**Content-addressed derivations are blocked here.** `__contentAddressed` is
refused at evaluation even with `--extra-experimental-features ca-derivations`
accepted by the client and `Trusted: 1`; the daemon validates the derivation
and cannot be told about a feature it was not started with. The prerequisite is
done: `.d.ts.map` files are deleted from build outputs, because they were the
only reason `tsc` output changed under a formatting-only edit, and nothing
downstream reads them. Note that exposing CA derivations as flake outputs makes
`nix flake check` fail, since it evaluates every attribute under `packages`.

**Sharing the workspace skeleton between derivations was examined and
rejected.** It could only ever recover the 69 ms line above: 6% of one unit, 2%
of a nineteen-unit run. What can be shared already is, as the `nodeModules`
derivation. Going further means a shared derivation holding the package
sources, which becomes an input to every test, so any source edit invalidates
all of them — the property the design exists to protect.

## Repo-specific traps

- **The commits are pushed now.** Authorisation was given late; CI at
  https://staging.nix-ci.com/gh:NorfairKing:nx-experiment/master is the real
  feedback loop and matters more than local `nix flake check`.
- **`results/` is only tracked because `.gitignore` has an explicit
  `!results/`.** A global gitignore carrying the Nix convention as `result*`
  rather than `result` swallows the whole directory. It did, for most of this
  experiment's life, and FINDINGS.md cited numbers from files that were not in
  the repository. Do not remove that line.
- **The harnesses mutate tracked files.** They need a clean tree and restore in
  a `finally` block. Commit before running one. Never `git add -A` after a
  harness aborts: that is how `const unused = 1` got committed into
  `packages/core/src/hash.ts` and sat there as dead code until a later run
  appended a second copy and `tsc` reported `TS2451`. Both harnesses now refuse
  to start if they find their `harness-mutation` marker in a file they are about
  to touch; keep that.
- **Harness mutations must be unique per run.** An identical repeated edit
  reproduces derivations an earlier run already built, and the measurement comes
  back as cache hits. That is how "Nx is 70× faster on a one-file change" got
  published; it is 7× the other way.
- **Nx must be invoked as `node_modules/.bin/nx`, not `pnpm exec nx`.** `pnpm
  exec` prints workspace chatter onto stdout when a manifest disagrees with the
  lockfile, which corrupts JSON the harnesses parse.
- Nx internals are reached through `nx/src/...`, which the export map exposes
  but does not promise. Pin Nx exactly; re-check on upgrade.

## What is open

1. Content-addressed derivations, blocked by the daemon (above).
2. Prototype 4, the Nx task graph becoming Nix derivations, is argued from the
   shape of the data and labelled as such, but never built. With one build and
   one test target per project this workspace's task graph is nearly its project
   graph relabelled, so there is little room for a gain.
3. A from-source build including the toolchain: deliberately not measured. It
   would be dominated by populating a throwaway store with Node, stdenv and the
   341-package pnpm closure, none of which is the question. The "every unit
   rebuilt" row already answers the useful version.

## The plan

In [PLAN.md](PLAN.md): what to do when the real repository is available. Phase
0 is the preconditions check, which decides whether Nx is needed at all.

The scaling question that used to be the plan is answered — evaluation is flat
to 400 projects, see FINDINGS.md — and `scripts/measure-scale.mjs` reproduces
it.
