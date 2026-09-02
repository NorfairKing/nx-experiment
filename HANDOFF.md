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

**The commits are not pushed.** Authorisation was asked for twice and never
given. Do not push without being told to.

The workspace is 19 projects (16 packages, 3 apps), 27 test files, 128
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

**The verdict.** Architecture C: the Nx project graph becomes the Nix graph, Nx
absent at execution time. Per-package granularity, with per-test-file only
where one package's test files are unevenly slow.

**The bridge is 69 lines and needs no Nx internals.** `nx graph --file` carries
project roots, dependency edges, target inputs, and the atomizer's
per-test-file target names. `scripts/nx-to-nix.mjs` distils it into
`nix/projects.json`. (`scripts/dump-nx.mjs` does reach into `nx/src/...`
internals, but only to measure Nx's task hashes and inputs for the comparison;
nothing built depends on it.)

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

**Cost, hook disabled, `--max-jobs 4`.** Nix 68 ms to establish everything is
current, against Nx 467 ms. Nix 3.80 s to rebuild after a shared-foundation
edit, against Nx 6.57 s. Nix 1.20 s for one isolated unit, against Nx 0.88 s —
the only case Nix loses, and about half of it is evaluation rather than work.
With the upload hook that same unit costs 3.25 s.

**Content-addressed derivations are blocked here.** `__contentAddressed` is
refused at evaluation even with `--extra-experimental-features ca-derivations`
accepted by the client and `Trusted: 1`; the daemon validates the derivation
and cannot be told about a feature it was not started with. The prerequisite is
done: `.d.ts.map` files are deleted from build outputs, because they were the
only reason `tsc` output changed under a formatting-only edit, and nothing
downstream reads them. Note that exposing CA derivations as flake outputs makes
`nix flake check` fail, since it evaluates every attribute under `packages`.

**Sharing the workspace skeleton between derivations was examined and
rejected.** The skeleton is not the expensive part; per unit it is roughly
0.6 s evaluation, 0.3 s stdenv plus tree assembly, 0.3 s Vitest. What can be
shared already is, as the `nodeModules` derivation. Going further means a
shared derivation holding the package sources, which becomes an input to every
test, so any source edit invalidates all of them — the property the design
exists to protect.

## Repo-specific traps

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

1. **Evaluation cost at scale.** The one thing that could still change the
   verdict. Evaluation is ~0.6 s per invocation and roughly half the per-unit
   cost at 19 projects, and flat across granularities. If it is linear in
   project count, then at 300 packages it is ~10 s per `nix build` and the
   approach gets uncomfortable. Nothing else in this list can move the
   recommendation.
2. Content-addressed derivations, blocked by the daemon (above).
3. Prototype 4, the Nx task graph becoming Nix derivations, is argued from the
   shape of the data and labelled as such, but never built. With one build and
   one test target per project this workspace's task graph is nearly its project
   graph relabelled, so there is little room for a gain.
4. A from-source build including the toolchain: deliberately not measured. It
   would be dominated by populating a throwaway store with Node, stdenv and the
   341-package pnpm closure, none of which is the question. The "every unit
   rebuilt" row already answers the useful version.

## The plan: measure evaluation cost at scale

The deferral of scale is spent, because the remaining question is a scaling
question. Phases are ordered so the cheap, safe measurement comes first and
answers the main question on its own.

### Phase 1 — a generator, output untracked

`scripts/generate-scale-workspace.mjs`, deterministic, taking a project count
and emitting a workspace with the same DAG shapes as the hand-written one
(shared foundation, diamonds, fan-ins, chains, orphans, a dev-only dependency),
into `scale/` — **gitignored**, so the 19-project baseline and every committed
number in `results/` stay untouched. Its own flake, reusing `nix/` by relative
path or a copy; do not make the main flake depend on generated content.

Sizes: 25, 50, 100, 200, 300.

### Phase 2 — evaluation scaling, eval only

This is the whole question and it needs no builds:

    nix eval --json .#packages.x86_64-linux --apply '<drvPath map>'

timed at each size, three runs each for variance, plus `nix flake show`-style
attribute counts. Record projects, derivations, evaluation ms. Look for the
shape of the curve, not the absolute: linear, and architecture C is
uncomfortable at 300; sublinear or flat, and it is settled.

Also worth capturing cheaply at each size: `nix eval` time for the bridge
(`nix/projects.json` grows linearly), and Nx's own graph-construction time,
since that is the other thing that scales.

Cost: seconds per measurement, no builds, no store mutation. Do this first and
the report can be written even if nothing else happens.

### Phase 3 — build cost at scale, only if phase 2 says the approach survives

At the largest size that stays comfortable, and with
`--option post-build-hook "" --max-jobs 4`:

- rebuild every unit (edit `vitest.shared.ts`, which invalidates every test
  derivation and no build derivation — never delete from the store),
- rebuild after a shared-foundation edit,
- `nix flake check` wall clock.

Watch `df -h` between sizes: a 300-package workspace's `node_modules` and
`pnpmDeps` FOD are not small, and each size is a separate store path.

### Phase 4 — write up

Extend the granularity section of FINDINGS.md with the scaling curve, and
settle or qualify the verdict. If evaluation turns out to be the binding
constraint, that is the most important result in the document, and it belongs
in the headline rather than the loose ends.

### What not to do

- Do not scale the hand-written 19-project workspace. Its numbers are cited
  throughout FINDINGS.md.
- Do not commit generated workspaces.
- Do not chase the per-unit 1.20 s further without a scaling answer first: at
  19 projects half of it is evaluation, and whether that half grows is exactly
  what phase 2 measures.
