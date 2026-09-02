# Findings

What Nx knows that Nix does not, which of it is worth moving across, and where
the two dependency models stop composing.

The workspace is 19 projects (16 packages, 3 apps), 27 test files, 128
assertions, shaped to contain a heavily shared foundation, a diamond, several
fan-ins, an isolated four-deep chain and an orphan. Small enough to check every
number by hand, which is the point at this stage: these are conclusions about
the two models, not about scale. Everything below is reproducible with the
scripts in `scripts/`; the numbers come from `results/`.

## The headline

Once both sides are configured carefully, **Nx's affected calculation and Nix's
derivation model agree almost everywhere**, and the interesting content of the
experiment is the handful of places they disagree and why.

Of 13 classes of change, Nx's task hashes and Nix's derivation paths select the
same set of tests in 11. In the two disagreements, Nix is right both times, for
two different reasons:

| change | Nx affected | Nx rehashed | Nix invalidated |
|---|---:|---:|---:|
| source of an isolated leaf | 1 | 1 | 1 |
| source of the shared foundation | 14 | 14 | 14 |
| source at the bottom of the chain | 4 | 4 | 4 |
| **source of a test-only dependency** | **8** | **8** | **4** |
| a test file | 1 | 1 | 1 |
| a package manifest | 1 | 1 | 1 |
| one package's vitest config | 1 | 1 | 1 |
| the shared vitest config | 19 | 19 | 19 |
| the shared tsconfig | 19 | 19 | 19 |
| the lockfile | 19 | 19 | 19 |
| a dead field of the root manifest | 0 | 0 | 0 |
| **pnpm-workspace.yaml** | **0** | **0** | **19** |
| a new README | 1 | 0 | 0 |

(19 test derivations / 19 test tasks. Full data in `results/change-matrix.json`.)

## Compare task hashes, not affectedness

`nx show projects --affected` answers a project-level question: which projects
contain a changed file, plus everything downstream. It does not consult a
target's inputs. Nx's *task hash* does, and that is the thing Nx actually reuses
or reruns. Comparing "nx affected" against Nix invalidation is a category
error, and it flatters Nix.

The README row is the clean demonstration: adding `packages/orphan/README.md`
makes Nx report the project as affected, while no test task hash changes. Nx
would select the task and then serve it from cache. The end result is right;
the selection is just coarser than the hashing.

Both numbers are reported throughout, because they answer different questions:
affectedness decides what gets scheduled, the hash decides what gets run.

## What Nx knows that Nix cannot cheaply obtain

1. **Which package a TypeScript import resolves to.** This is the whole reason
   the bridge is worth anything. Nix has no idea that
   `import { hashHex } from '@nx-exp/core'` inside `packages/strings/src/slug.ts`
   is an edge. Recomputing it in Nix would mean reimplementing module
   resolution, `exports` maps, path aliases and pnpm's linking rules.

2. **The set of test files Vitest would run**, including the atomizer's
   per-file task split, without booting Vitest per project.

3. **Which target depends on which**, and the inputs each target declares.

Everything else Nx knows about *this* workspace turned out to be derivable from
the manifests directly, which matters for how much machinery the bridge needs.

## What Nx does not know, or loses

### The project graph collapses dev and runtime dependencies

`@nx-exp/parser` declares `ast`, `lexer` and `tokens` as dependencies and
`test-utils` as a dev dependency. Nx's project graph reports all four as
`type: "static"` edges. Nothing in the graph distinguishes them.

The consequence is the largest disagreement in the matrix. Editing
`packages/test-utils/src/random.ts` rehashes eight test tasks:

```
cli  compiler  lexer  parser  report  runtime  test-utils  web
```

while Nix invalidates four:

```
lexer  parser  runtime  test-utils
```

Nix is right. `test-utils` is a dev dependency of `lexer`, `parser` and
`runtime`, so it never enters their `dist`. `compiler` consumes `parser`'s
build output, and `report`, `cli` and `web` are further downstream still: none
of them can observe a change to `test-utils`. Nix knows this because
`build-parser`'s closure literally does not contain `test-utils` —
`nix-store -q --references` on `nx-exp-parser-dist` lists exactly `ast`,
`lexer` and `tokens`.

Nx reaches the wrong answer because `^sources` follows every edge in a graph
where the distinction was already discarded. The fix is not in Nx's graph but
in the bridge: `scripts/nx-to-nix.mjs` re-reads the manifests to recover the
split. That is a one-line-per-project lookup, not an analysis.

### One named input Nx shares between tools that do not share it

Every package's `tsconfig.json` extends `tsconfig.base.json`, and every
package's `vitest.config.ts` merges `vitest.shared.ts`. Neither tool reads the
other's file: `tsc` has never heard of the Vitest config.

Nx's `sharedGlobals` is one list, handed to whatever named input references it,
so both files are inputs to both the build and the test target. Editing
`vitest.shared.ts` rehashes **all 14** build tasks in the task graph as well as
all 19 test tasks. The 14 is not a subset chosen for relevance — it is simply
how many projects have a dependant, and so have a `build` task in the graph at
all.

Nix invalidates **19 test derivations and 0 build derivations**, because the
build fileset and the test fileset name different workspace-root files. The
`results/change-matrix.json` row reads `shared-vitest-config: tests 19,
builds 0` against `nxRehashedBuilds 14`.

This is fixable in Nx — two named inputs instead of one shared list — so it is
a default worth knowing rather than a limitation. But it is the same shape as
the two below: the grouping is a thing somebody has to declare correctly, and
the natural declaration is coarser than the truth. This experiment had the bug
too, and only found it when a Vitest-config edit turned out to be rebuilding
every `tsc` output.

### Two inputs Nx's named inputs miss

**`pnpm-workspace.yaml` is not an input to anything.** Editing it changes 0 Nx
task hashes and invalidates all 19 Nix test derivations. That file decides what
counts as a workspace package and carries install-affecting settings
(`allowBuilds`, `minimumReleaseAge`). A change to it can change what gets
installed, and Nx would rerun nothing at all. Nix cannot miss it, because the
install derivation reads it and every test derivation depends on the install.

**The lockfile is only an input if you say so.** With the lockfile absent from
`sharedGlobals` — which is how this repo started — a lockfile change gave
`nx affected` all 19 projects and **0 rehashed test tasks**. Nx would have
selected every test and then served every one from cache. A dependency version
change would have run no tests. Adding `{workspaceRoot}/pnpm-lock.yaml` to
`sharedGlobals` fixes it, and that is the row in the table now.

The shape of both hazards is the same: in Nx, an input exists because someone
declared it, and a missing declaration fails silently and in the unsafe
direction. In Nix an input exists because a derivation reads it. That asymmetry
is the strongest correctness argument for the Nix side in this experiment, and
it has nothing to do with granularity.

The per-file input comparison (`results/input-comparison.json`) says the same
thing: across four representative packages, Nix's inputs miss nothing that
should affect the test, and Nx's miss `package.json` and `pnpm-workspace.yaml`
every time.

### The atomizer's file discovery honours .gitignore

`@nx/vitest`'s default `discoverTestFiles: "glob"` enumerates test files through
Nx's workspace file index, which respects `.gitignore`. A test file that is
present on disk but gitignored gets **no atomized target**, while plain
`vitest run` still runs it.

This was not sought out. An early `packages/core/tests/result.test.ts` produced
one atomized target instead of two, and the cause was a `result*` line in a
global gitignore — a Nix convention, since `result` is what `nix build`
symlinks to. A Nix + Nx repository is therefore unusually likely to hit it, and
any file whose name starts with `result` disappears from Nx's view.
`discoverTestFiles: "vitest"` finds both files.

The failure is silent in the dangerous direction: fewer tests, still green.

This repository therefore sets `discoverTestFiles: "vitest"`, which enumerates
through Vitest itself and finds both files. It costs more at graph-creation time
(Nx boots Vitest per project rather than globbing an index) and it is the right
trade: the glob is an approximation of Vitest's resolution, and where they
disagree the approximation loses tests.

## What Nix expresses well, and what it does not

### A per-package output must carry its own node_modules

The first version of the per-package build derivations produced
`$out/{package.json,dist}` and failed as soon as a dependency had a dependency:

```
Error: Cannot find package '@nx-exp/chain-d' imported from
  /nix/store/...-nx-exp-chain-c-dist/dist/index.js
```

Node resolves a bare specifier by walking up from the *importing* file, and
nothing walks up from a store path. The fix is for each build output to contain
`node_modules/@nx-exp/<dep>` symlinks into its dependencies' store paths, which
makes every output a self-contained runtime closure. Once it does, Nix's
recorded references reproduce the package graph exactly, and the dependency
model works with no further help.

This is the one piece of real Nix design work the JavaScript ecosystem forces,
and it is worth knowing before starting.

### The shared install is where Nix goes coarse

Section 13 of the brief warns against `src = ./.`. The subtler version of the
same mistake is a single shared node: the pnpm install.

Taking every `package.json` verbatim as the install's input meant that adding a
`description` to `packages/orphan/package.json` invalidated **all 19** test
derivations, against Nx's correct 1. One irrelevant edit in one leaf package,
and the whole workspace rebuilds.

Narrowing the input fixes it, but *where* the narrowing happens decides whether
it works at all. pnpm only reads a manifest's identity and its dependency
specifiers, so the install should depend only on those fields. Doing the
reduction in a build step does not help: that step still takes the full
manifests as input, so its derivation path still changes and everything
downstream still rebuilds. Doing it in the **evaluator** does help:

```nix
reduceManifest = path:
  let raw = builtins.fromJSON (builtins.readFile path); in
  builtins.toFile "package.json" (builtins.toJSON { inherit (raw) name version; ... });
```

`builtins.toFile` addresses the result by content, so an edit to an ignored
field produces the same store path and nothing downstream moves. The
`package-manifest` row went from 19/19 to 1/19.

This is early cutoff, obtained at evaluation time, without content-addressed
derivations. It only works for inputs cheap enough to normalise in the
evaluator, which manifests are and source trees are not.

### Test outputs are not reproducible, and need not be

An attempt to make the test derivations pass `nix build --rebuild` (their
outputs embedded Vitest's start time and durations) was the wrong instinct. A
test run is not reproducible and does not need to be: the derivation succeeding
*is* the evidence the tests passed, and nothing consumes the log. `--rebuild`
and `--check` simply do not apply to this class of derivation, and the cold
benchmark deletes outputs instead.

The one real trap nearby is exit status. `vitest run | tee $out/log` reports
`tee`'s status, so a failing test yields a *successful* derivation. `set -o
pipefail` is load-bearing, and worth checking deliberately: with a broken
assertion, `nix build .#test-orphan` exits 1.

## Content-addressed derivations: the prerequisite, and the blocker

The motivating case is early cutoff. A formatting-only edit to
`packages/core/src/hash.ts` changes that file, so `build-core` rebuilds — fair
enough — but its *output* need not change, and every dependent's derivation
rebuilds anyway because it refers to `build-core` by the store path that
produced it rather than by what it produced. Content-addressed derivations are
the mechanism that stops that propagating.

### The prerequisite is a real finding on its own

For early cutoff to fire, `tsc`'s output has to actually be byte-identical
under a change that does not affect semantics. It was not:

```
before/after a formatting-only edit to core:
  DIFFERS: ./dist/hash.d.ts.map
```

`dist/hash.js` and `dist/hash.d.ts` were identical. The **declaration map** was
the only difference, and of course it was: a `.d.ts.map` exists to encode
source positions, so any edit that moves a line changes it. One artifact whose
entire purpose is to record where things were in the source is enough to defeat
content addressing for the whole package.

Nothing that consumes a build output reads it. A dependent's `tsc` reads the
`.d.ts`; its Vitest reads the `.js`. Declaration maps are for an editor jumping
from a `.d.ts` back to the `.ts`, and an editor does that against the workspace,
not against a Nix store path. So `nix/per-package.nix` deletes them from the
output, and after that the output *is* byte-identical under a formatting-only
edit while the input-addressed store path still changes — which is exactly the
situation content addressing exists to fix.

This generalises past this experiment: **before reaching for content-addressed
derivations, check that the build output does not contain a positional
artifact.** Source maps, declaration maps, build timestamps and embedded paths
all guarantee the output changes whenever the input does, and they are usually
emitted by default.

### The blocker

The experiment itself could not be run on this machine. `__contentAddressed =
true` is refused at evaluation time:

```
error: experimental Nix feature 'ca-derivations' is disabled;
       add '--extra-experimental-features ca-derivations' to enable it
```

It is refused *with* that flag passed. `nix config show experimental-features`
confirms the client accepted it (`ca-derivations fetch-tree flakes
nix-command`) and `nix store info` reports `Trusted: 1`, and it is still
refused — for a bare `builtins.derivation` as much as for a stdenv one. The
store is the daemon (`Store URL: daemon`), and the daemon validates the
derivation when it is written to the store; a client cannot enable a feature
the daemon was not started with. Enabling it means editing the daemon's
configuration and restarting it, which is a change to the user's system and
outside what this experiment should be doing unasked.

Worth knowing if you try this: exposing content-addressed derivations as flake
outputs makes **`nix flake check` fail**, because it evaluates every attribute
under `packages` and the eval is what throws. The experiment has to be gated
somewhere `flake check` does not reach, or it takes the feedback loop down with
it.

So the honest state: the prerequisite is done and measured, the mechanism is
untested, and the recipe is four attributes on the build derivation
(`__contentAddressed = true`, `outputHashAlgo = "sha256"`,
`outputHashMode = "recursive"`), kept out of `packages`. The observable to use
is whether `build-strings`'s output path survives a formatting-only edit to
`core`; input-addressed, it does not.

## Granularity: what per-test-file buys

| granularity | Nix nodes | evaluation | invalidated by one test-file edit | by a shared source edit |
|---|---:|---:|---:|---:|
| per package | 19 | 476 ms | 1 / 19 | 14 / 19 |
| per test file, whole project as input | 27 | 467 ms | 2 / 27 | 22 / 27 |
| per test file, single test file as input | 27 | 450 ms | 1 / 27 | 22 / 27 |

Evaluation time is whatever Nix's caching gives on a repeated call — nothing
cheap forces a cold evaluator — so read the column as a comparison between
levels rather than an absolute. It is stable to within about 40 ms across runs.
An earlier draft recorded 1.6 s here and attributed the difference to
broadening the test filesets to whole project directories; three repeat runs
put it back at 440–490 ms, so that figure was a cold-evaluation outlier and the
explanation built on it was wrong.

Two things stand out.

**Finer granularity barely improves invalidation.** For a source change the
fraction gets slightly *worse* (74% → 81%), because splitting a package into
several nodes splits nodes that were going to be invalidated anyway. Only an
edit confined to one test file benefits, and only in the narrow variant.

**Evaluation cost is flat at this size.** 19 versus 27 nodes is far too small to
say anything about the brief's question of what happens at thousands of
derivations. That question is still open and needs a bigger workspace.

The real argument for per-file granularity is parallelism and distribution, not
reuse. Which is exactly what Nx's atomizer is for.

## The Nx Cloud gate

Nx knows the per-test-file split and puts it in the graph for free:

```
@nx-exp/core:test-ci--tests/hash.test.ts
@nx-exp/core:test-ci--tests/outcome.test.ts
```

But `nx run @nx-exp/core:test-ci` — the *group* target — refuses to run:

```
NX  The @nx-exp/core:test-ci task should only be run with Nx Cloud.
Please enable Nx Cloud or use the slower "test" task.
```

The individual atom targets run locally with no such restriction. So Nx will
compute the atomization and hand it over, but will not orchestrate it unless
you buy the hosted service.

This is the clearest case in the whole experiment of Nx holding information
that another executor can act on. Nix can run those atoms, cache them
individually, and distribute them, with no Cloud involved. If there is one
argument for the bridge that does not also have a simpler alternative, it is
this one.

## Enumeration is the silent failure mode, and it is fixable

Every per-test-file scheme rests on a list of test files. That list is the only
place the design can fail quietly: a file missing from it gets no derivation,
and every derivation that does exist still passes.

Demonstrated by removing `tests/outcome.test.ts` from `nix/projects.json`:
`nix build .#file-core--tests-hash-test-ts` succeeds, the workspace looks
green, and four assertions never ran.

`nix/per-test-file.nix` closes this with a guard derivation per project that
asks Vitest what it would actually run:

```
vitest list --filesOnly --json
```

and fails when that disagrees with the generated list. With the file removed,
`nix build .#guard-core` exits 1 and says which file has no derivation. The
guards are part of `nix flake check`, so the hole cannot reopen unnoticed.

### The same hole for the dependency edges

The test-file list is not the only thing the bridge caches. The dependency edges
are cached too, and their drift cases are not symmetric:

| drift | consequence |
|---|---|
| an edge `nix/projects.json` has that reality lacks | over-approximates, runs too much, harmless |
| an edge reality has that `nix/projects.json` lacks | the dependency's store path is never linked, so `tsc` or Vitest cannot resolve the import — loud |
| **a project missing from `nix/projects.json` entirely** | **no derivation is generated, its tests never run, nothing reports a problem** |

Only the third is silent, and it is the one that happens when somebody adds a
package and forgets to regenerate. `nix build .#graphAgreement` closes it. That
derivation rebuilds the project table from the manifests alone — projects
discovered by globbing the source tree, not read from any Nix-side list — and
fails when it disagrees with the checked-in table.

Being independent of Nx is the point. A guard generated from the same source as
the data it checks proves only that the generator is deterministic; this one
would notice a project Nx never reported, or one Nx reported and the bridge
dropped.

Demonstrated against four kinds of drift, each caught with a specific message:

- deleting `orphan` from the table — the test derivations silently fall from 19
  to 18, and the guard exits 1 with *"orphan (packages/orphan) is a workspace
  project with no entry in nix/projects.json, so no derivation is generated for
  it and its tests never run"*;
- reclassifying `test-utils` from a dev dependency of `parser` to a runtime one,
  which would quietly undo the 4-versus-8 precision win;
- dropping `tokens` from `parser`'s dependencies;
- adding a package and not regenerating.

### And a third hole: nothing was typechecking

A package's tests deliberately do not depend on that package's own build — the
tests import `src` directly, and that independence is a precision win. But
**Vitest does not typecheck.** Vite strips types through esbuild without
checking them, so a type error in a package's source is invisible to its tests.
Combine the two and a leaf package with no dependants was never typechecked by
anything in `nix flake check`, because nothing in the check set built its
`dist`.

Confirmed by putting `const size: number = 'thirty-two'` in
`packages/orphan/src/base32.ts`: `nix build .#test-orphan` passed,
`nix build .#build-orphan` reported `TS2322`. The build derivations are now
part of `nix flake check` too, which takes it from 39 checks to 59.

So the complete story needs three checks, because "is the cache still valid?"
has three parts:

| question | check | derived from |
|---|---|---|
| is every project represented? | `graphAgreement` | the manifests, via `readDir` |
| are the declared edges the ones in the table? | `graphAgreement` | the manifests |
| are the declared edges the ones the source imports? | `build-*` | pnpm-strict resolution and `tsc` |
| is every test file represented? | `guard-*` | Vitest's own enumeration |

This generalises: **any scheme that transfers a work-list from one tool to
another needs a check that the list is still complete**, and the check has to be
adversarial rather than derived from the same source as the list.

## A tsconfig is a manifest; a Vitest config is a program

The build and test derivations started with the same kind of hand-written
fileset: name `src`, `tests`, `package.json`, `tsconfig.json` and
`vitest.config.ts`, and nothing else can invalidate this target. For the build
that is sound, because a tsconfig *states* which files `tsc` reads.

For the test it was an assumption, and it broke the first time it was tested.
Giving `packages/orphan` a `setupFiles: ['./test-setup.ts']` entry — outside
`tests/`, which is where a real repository often puts it — produced:

```
Error: Cannot find module '/build/source/packages/orphan/test-setup.ts'
```

A Vitest config is not a manifest. It is a program that can pull in setup files,
global setup, fixtures, snapshot directories and custom reporters from anywhere
under the project, and none of that is visible to whoever writes the fileset.
The test derivations now take the whole project directory; the build derivations
keep their precise fileset, because there the precision is justified.

The cost is real and shows up in the matrix: the README row went from
`nix invalidated 0` to `nix invalidated 1`. Nix now over-invalidates by one
where Nx's hash correctly ignores the file. That is the honest trade, and the
0 was never precision — it was an unsound guess that happened to hold.

The general rule: **name inputs precisely only where the tool declares them.**
Where the tool's configuration is arbitrary code, the directory is the input.

## The section 17 cases

The brief asks for deliberate correctness cases and says plainly that a
conservative system running a little too much beats one that silently omits
tests. `scripts/correctness-probes.mjs` breaks four things and records which
mechanism notices; results in `results/correctness-probes.json`.

| case | `build-orphan` | `test-orphan` | `graphAgreement` | Nx edge reported |
|---|---|---|---|---|
| imports a package its manifest does not declare | fails | fails | passes | **none** |
| type error in code no test exercises | fails | **passes** | passes | — |
| reaches into another package via a `tsconfig` `paths` alias | fails | fails | passes | **none** |
| imports an uncommitted generated source file | fails | fails | passes | — |

Every case fails loudly. None of them silently ran fewer tests, which is the
outcome section 17 actually cares about. The type error is the one that would
have slipped through before the build derivations joined the check set.

Two results correct something asserted earlier in this document. The loose ends
used to claim that path aliases and undeclared imports are "a place where Nx's
resolution knowledge is worth more than it is here". **Nx reported no edge at
all** in either case: not for the undeclared import, and not for the
cross-package `tsconfig` `paths` alias. Nx's resolution runs through pnpm's
strict layout, so an import that cannot resolve produces no edge rather than a
detected-but-undeclared one. Nx is not smarter than the manifests here; it is
reading the same thing.

That also means the `unclassifiedNxEdges` field the bridge computes — Nx edges
no manifest explains — stays empty not because the workspace is tidy but
because Nx cannot produce such an edge in a pnpm-strict workspace. It is a
guard against a case that may not be reachable, which is worth knowing before
relying on it.

The generated-source case is symmetric blindness: Nix's filesets come from the
git tree and Nx's file index does too, so neither sees an uncommitted generated
file, and the build fails loudly for both. A repository that generates sources
would have to commit them or generate them inside the derivation.

## Cost

This section has been wrong three times, each time in Nix's disfavour, and each
time because the measurement was picking up something other than the thing
being asked about. The third correction is the largest.

### The cache upload hook was most of the cost

This machine runs a Nix post-build hook that uploads every output to a shared
binary cache. That is deployment policy, orthogonal to whether Nix can test a
monorepo granularly — and it dominated every Nix figure in this document.

Measured on the same unit of work, one leaf package's test derivation, rebuilt
after a unique edit:

| | one unit |
|---|---:|
| with the upload hook | 3.25 s |
| without it | **1.20 s** |

Two seconds per derivation, of pure upload. On trivial derivations that do
nothing but `touch $out`, the marginal cost of one more is about **1200 ms with
the hook and about 20 ms without** — sixty times everything else combined.

The figure this section previously reported as "the fixed cost per Nix
derivation", 3.06 s, was therefore about two thirds cache upload. Every Nix
number below has the hook disabled, and `results/benchmark.json` records
`postBuildHookDisabled: true` so it cannot quietly come back.

### The numbers

Nix at `--max-jobs 4`, hook disabled; Nx with its own cache.

| | Nix | Nx |
|---|---:|---:|
| every test, nothing to do | **68 ms** | 467 ms |
| one leaf unit, after an edit to it | 1.20 s | **0.88 s** |
| every test, after an edit to the shared foundation | **3.80 s** | 6.57 s |
| every unit rebuilt (19 per-package units) | **3.43 s** | 6.56 s |
| every unit rebuilt (27 per-test-file units) | 4.05 s | 3.45 s |

The last two rows are the well-defined replacement for the cold column this
section used to carry and then withdrew. Editing the shared Vitest config
invalidates every test derivation and no build derivation, so each granularity
rebuilds its whole set from a state nothing has built: the same work as a cold
run, with nothing deleted from anyone's store.

**This reverses the previous conclusion.** This section used to say Nix "does
not buy speed" and was "7× slower on a one-file change". With the upload hook
out of the way Nix is *faster* on every aggregate case — 1.7× on the
shared-foundation edit, 1.9× on rebuilding everything, 7× when there is nothing
to do — and slower only on a single isolated unit, by 1.4×. The earlier 7× was
the hook.

### Where the remaining per-unit cost goes

For one leaf test derivation, roughly:

| | |
|---|---:|
| Nix evaluation and client overhead | ~0.6 s |
| stdenv and assembling the package's tree | ~0.3 s |
| Vitest itself (~5 ms of assertions) | ~0.3 s |

Vitest run directly in the live workspace takes 290 ms, so about a quarter of
the derivation is irreducible. A derivation that does nothing at all still
costs several hundred milliseconds, and dropping stdenv for a raw
`builtins.derivation` saved under 200 ms of that. Disabling the sandbox changed
nothing measurable.

**So the plan this document previously named as "the first thing to do" —
sharing the workspace skeleton between derivations — is not worth doing, and
the measurement is why.** The expensive part was never the skeleton. What is
shared can already be shared: `nodeModules` is one derivation that every test
symlinks, and the remaining per-derivation work is a handful of `ln -s` calls.
Going further would mean a shared derivation containing the package sources,
and that would become an input to every test, so any source change would
invalidate all of them. The whole point is that `packages/foo`'s test does not
depend on `packages/bar`. There is nothing meaningful left to share without
giving that up.

### What this means for atomization

Splitting 19 units into 27 costs Nix 3.43 s → 4.05 s, about 18% more, and
buys almost no invalidation (22/27 against 14/19 for a source change). For Nx
the same split *saves* 47%, 6.56 s → 3.45 s, because the slow files stop
queueing behind a package-level task. The direction is unchanged from the
earlier draft; the magnitude is not — the Nix penalty is 0.6 s, not the 24 s
that was inferred from the hook-contaminated per-unit figure.

At 27 units Nix (4.05 s) and Nx's atomized run (3.45 s) are close enough that
the choice stops being about speed.

There is a sting in the tail, though, and it is a real deployment finding
rather than an artifact. **A per-derivation post-build hook penalises fine
granularity in direct proportion to the number of derivations.** At roughly 2 s
of upload each, going from 19 units to 27 adds about 16 s of upload for nothing.
Anyone running Nix with a binary cache should count derivations, not just
rebuilds.

### The honest summary

On this workspace, with the machine's cache upload out of the picture, **Nix is
competitive on speed and wins outright once anything is cached**: 68 ms to
establish that every test is up to date, against 467 ms for Nx, and the Nix
answer does not depend on a local cache directory whose inputs somebody had to
declare correctly.

It is slower for one isolated unit, 1.20 s against 0.88 s, and that gap is the
one to care about, because it is what an editor-driven inner loop hits. Half of
it is Nix evaluation rather than work.

## How hard is the transfer

Small, and that is a genuine finding: the bridge is 69 lines.

- `nx graph --file` exports the graph.
- `scripts/nx-to-nix.mjs` (69 lines) reduces it to `nix/projects.json`: per
  project, its root, its runtime and dev dependencies, and its test files.
- `nix/per-package.nix` and `nix/per-test-file.nix` read that file.

And it needs no Nx internals. The documented export

```bash
nx graph --file=results/nx-graph-export.json
```

carries everything the bridge reads: each project's root, the dependency edges
under `graph.dependencies`, each target's declared `inputs` and `dependsOn`,
and — the useful part — the atomizer's per-test-file target names, from which
the test file paths fall straight out:

```
@nx-exp/core → test-ci--tests/hash.test.ts, test-ci--tests/outcome.test.ts
```

This was not obvious at the outset, and the first version of the bridge went
through `nx/src/...` for all of it. The internal APIs are still used, but only
by `scripts/dump-nx.mjs` and `scripts/input-comparison.mjs`, which measure Nx's
task inputs and hashes for the comparison in this document. Nothing the
prototypes build depends on them.

That matters for the practical answer to "is this a stable interface?":

- For **building the bridge**: yes. `nx graph --file` is a documented command
  with a stable shape.
- For **comparing input models**, as this experiment does: no.
  `createTaskGraph`, `getInputs`, `getTargetInputs`, `createTaskHasher` and
  `createProjectFileMapUsingProjectGraph` are all reached through `nx/src/...`.
  The export map exposes `./src/*`, so they are importable, but they carry no
  compatibility promise and their shapes are pinned to the locked Nx version.

The one thing the documented export does not carry is the dependency/dev
dependency distinction, which comes from the manifests.

## The architectures

**A. Nix alone.** Viable but you pay for it. Nix cannot find the import edges,
so they have to come from somewhere; deriving them from `package.json`
`dependencies` alone gets the package graph but not which *files* participate,
so source filesets stay at directory granularity. Correct, and coarser.

**B. `nx affected` selects Nix derivations.** The simplest thing that works,
and it is worth having on day one. But it is strictly worse than C: it keeps Nx
in the execution path, inherits Nx's project-level over-selection, and gets
nothing that Nix's own invalidation would not have got, since the Nix
derivations already encode the graph. Useful as a fast pre-filter, not as the
mechanism.

**C. The Nx project graph becomes the Nix graph.** This is the sweet spot. Nx
runs once, at generation time, to produce `nix/projects.json`; after that Nix
alone decides what to rebuild, and it decides correctly — including the
dev-dependency case Nx itself gets wrong, and the `pnpm-workspace.yaml` case Nx
misses. Nx is not needed at execution time at all.

**D. Nx tasks become Nix derivations.** *Not built, so this is an argument from
the shape of the data rather than a measurement, and should be read as such.*
The task graph carries two things C does not: `dependsOn` ordering, which C
already recovers from the package graph, and the per-task inputs, which
`results/input-comparison.json` shows to be less complete than the filesets
written directly in Nix — they are the two entries Nx misses, the root manifest
and `pnpm-workspace.yaml`. With one test target and one build target per
project, this workspace's task graph is very nearly its project graph relabelled,
so there is little room for a gain. Worth actually building for a workspace with
several targets per project, where that stops being true.

**E. Nx test atoms become Nix derivations.** The one place Nx supplies something
genuinely new — the per-file split, and past the Cloud gate. The cost is
modest, 18% on rebuilding everything, and it barely improves invalidation, so
it earns its place only where per-file parallelism buys something a
package-level task cannot: a package whose test files differ a lot in runtime,
so the slow ones stop queueing behind the fast ones. It also adds the
enumeration hazard, so only with the guard in place — and if outputs are pushed
to a binary cache, count the extra derivations, because a post-build upload
hook charges roughly 2 s each.

**Verdict: C, with E where a package's test files are unevenly slow.** Take the
project graph from Nx, recover the dev/runtime split from the manifests, build
per-package derivations with filesets that are precise for `tsc` and
whole-directory for Vitest, and reach for per-file derivations only where the
parallelism pays.

## Does it compose?

Yes, with one caveat that is worth stating plainly.

The two models did not fight each other anywhere. Nix's content-addressed
invalidation and Nx's semantic analysis sit at different layers: Nx answers
"what depends on what", once, offline; Nix answers "what must be rebuilt", every
time, from content. Feeding the first into the second worked, and the result was
at least as precise as Nx on every change class tested and strictly more precise
on two.

The caveat: **the generated bridge is a cache of a semantic analysis, and stale
caches are silent.** `nix/projects.json` is checked in. If a developer adds a
dependency or a test file and does not regenerate it, Nix builds a graph that no
longer matches the code, and the failure direction is "ran fewer tests, all
green". Closing that is what the guards are for, and it takes three separate
checks because the question has three parts.

## Loose ends

- Evaluation cost at 100–300 packages and thousands of derivations is untested;
  everything here is at 19 projects. This is the main thing scale would tell us.
- Content-addressed derivations remain untested: the daemon on this machine
  does not have `ca-derivations` enabled and enabling it is a system change.
  The prerequisite is now in place — see the section above — so the experiment
  is a few attributes away for anyone whose daemon allows it.
- The remaining per-unit gap, 1.20 s against Nx's 0.88 s, of which roughly half
  is Nix evaluation rather than work. Sharing the workspace skeleton was
  examined and rejected on measurement; see the cost section.
- Whether the evaluation half of that shrinks or grows with the number of
  projects. At 19 projects it is around 0.6 s per invocation and flat across
  granularities, which says nothing about 300.
- Prototype 4 (the Nx task graph becoming Nix derivations) is argued against
  below from the shape of the data rather than measured. It was never built.
