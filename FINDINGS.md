# Findings

What Nx knows that Nix does not, which of it is worth moving across, and where
the two dependency models stop composing.

The workspace is 19 projects (16 packages, 3 apps), 27 test files, 129
assertions, shaped to contain a heavily shared foundation, a diamond, several
fan-ins, an isolated four-deep chain and an orphan. Small enough to check every
number by hand, which is the point at this stage: these are conclusions about
the two models, not about scale. Everything below is reproducible with the
scripts in `scripts/`; the numbers come from `results/`.

## The headline

**For a pnpm workspace with isolated linking, Nix does not need Nx.**

That is not where this experiment expected to land. The premise was that Nx had
done expensive semantic analysis worth importing, and the question was how to
get it into Nix. Measurement says there is nothing to import:

- Nx knows dependencies at **exactly one level**, project to project, and
  derives them from the manifests. Of the 126 files it tracks, 16 carry
  dependency information and all 16 are `package.json`; none of the 88
  TypeScript files carries any (`results/nx-dependency-levels.json`).
- Nix can read those same manifests during evaluation. Doing so produces a
  **byte-identical set of derivation paths** — all 38 — at the same evaluation
  cost, with no generated file to keep in sync and no import-from-derivation.
- Evaluation stays flat to 400 projects: 16× the projects for 1.4× the
  evaluation time.

The reason the manifests suffice is pnpm's isolated linking: an import of an
undeclared workspace package does not resolve, so it is a hard build error
rather than a missing edge. Nx reports no edge for one either. Under a hoisted
layout, or where edges come from `tsconfig` path aliases, that stops being true
and Nx's analysis earns its place — hence the preconditions below.

The one thing Nx supplies that manifests cannot is the **per-test-file split**,
which it gets by asking Vitest. That is worth having only where a package's
test files are unevenly slow.

The rest of this document is the evidence, and the parts of it that were wrong
along the way.

### The two models compared

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
| a new README | 1 | 0 | 1 |

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

Short list, and it got shorter as the experiment went on. **The per-test-file
split** is the only entry: Nx enumerates a project's test files by asking
Vitest, and no amount of reading manifests recovers that.

### The retraction

An earlier draft's first entry was "which package a TypeScript import resolves
to", described as "the whole reason the bridge is worth anything", on the
grounds that recomputing it in Nix would mean reimplementing module resolution,
`exports` maps, path aliases and pnpm's linking rules.

That was wrong, and wrong in an interesting way. Nix never has to resolve the
import, because in a pnpm workspace **Nx does not resolve it either.** Nx reads
the manifest. `results/nx-dependency-levels.json`: every one of the 16
dependency-carrying files in its file map is a `package.json`, and none of the
88 TypeScript files carries a single edge. The `deps` field exists in Nx's
model — the data structure would support file-level edges — and it is empty
throughout.

Two probes make the same point from the other side
(`results/correctness-probes.json`). An undeclared import of a workspace
package: Nx reports **no edge**. A cross-package `tsconfig` `paths` alias: Nx
reports **no edge**. Both fail the build loudly instead, because pnpm's
isolated `node_modules` never linked the package. Nx's resolution runs through
that same layout, so an import it cannot resolve produces nothing rather than a
detected-but-undeclared edge.

The lesson generalises past Nx: **before building a bridge to import another
tool's analysis, check that the analysis exists.** The field being present in
the schema is not the same as the field being populated, and one `jq` query
would have saved a day's work.

### What Nx also knows, that is not analysis

- **Which target depends on which**, and the inputs each target declares. This
  is configuration, read back — `nx.json` says it, and so could a flake.
- **External npm dependencies**, 400 of them here. Lockfile-derived, and Nix
  already consumes the lockfile through the pnpm fixed-output derivation.

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

**Two seconds per derivation, of pure upload**, against 1.20 s for everything
else the derivation does put together — unpacking its source, assembling the
package's tree, and running Vitest.

The figure this section previously reported as "the fixed cost per Nix
derivation", 3.06 s, was therefore about two thirds cache upload. Every other
Nix number below has the hook disabled, and `results/benchmark.json` records
`postBuildHookDisabled: true` so it cannot quietly come back.

The cost is per derivation, which is why it matters here rather than being
somebody else's problem: it is charged again for every unit the granularity is
split into.

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

## How hard is the transfer, if you need one

On a pnpm workspace with isolated linking you do not: `nix/graph.nix` reads the
manifests during evaluation and that is the whole mechanism. This section is
for the case where a precondition fails and Nx's answer really does have to
reach the evaluator.

It is small — 69 lines:

- `nx graph --file` exports the graph.
- `scripts/nx-to-nix.mjs` reduces it to a table: per project, its root, its
  runtime and dev dependencies, and its test files.
- Dropping that table at `nix/projects.json` switches `nix/graph.nix` to it
  with no other change. Every derivation path comes out identical to the
  manifest-derived ones, which is how the two were shown to be equivalent in
  the first place.

There is a third option, which this repo does not need and so does not pay
for: **import-from-derivation** — run Nx inside a derivation and import the
result. That keeps the answer always fresh, at the cost of a build during
evaluation, and it is unavailable wherever restricted evaluation is in force.
The generated-table route is the same information with the freshness traded for
a file somebody has to regenerate, which is what the guards then have to check.

And none of it needs Nx internals. The documented export

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

**A. Nix alone.** *The recommendation, for a pnpm workspace with isolated
linking.* An earlier draft of this document dismissed A as "viable but you pay
for it… correct, and coarser", on the assumption that Nix could not find the
import edges and that filesets would have to stay at directory granularity.
Both halves of that turned out to be wrong:

- **The edges are in the manifests.** `nix/graph.nix` derives the whole project
  graph during evaluation with `readDir` and `fromJSON`, and it produces a
  *byte-identical* set of derivation paths to the generated table it replaced —
  all 38 of them. It costs the same to evaluate, 200–207 ms either way.
- **Directory granularity was not a cost.** For the test derivation it is the
  *correct* input set, because a Vitest config is a program that can read
  anything under the project. For the build derivation a precise fileset is
  available and used, because a tsconfig declares what `tsc` reads.

So A needs no Nx, no generated file, and no import-from-derivation, and gives
up nothing measurable.

**B. `nx affected` selects Nix derivations.** Rejected. It keeps Nx in the
execution path and inherits Nx's project-level over-selection, which is coarser
than Nx's own task hashing, let alone Nix's. The derivations already encode the
graph, so the selection adds nothing. Worth restating because the original
brief floated it: **use Nx's graph, not its affected calculation** — and it
turns out you do not need either.

**C. The Nx project graph becomes the Nix graph.** What this document
recommended until the measurements above. Still the right answer *if* the
manifests stop being the graph — see the preconditions below — and
`nix/graph.nix` keeps it available as a one-file override, with
`scripts/nx-to-nix.mjs` generating the table. Where it applies, prefer it to B
for the same reasons: Nx runs once, offline, and never at execution time.

**D. Nx tasks become Nix derivations.** *Not built, so this is an argument from
the shape of the data rather than a measurement, and should be read as such.*
The task graph carries two things the project graph does not: `dependsOn`
ordering, which is recoverable from the package graph, and the per-task inputs,
which `results/input-comparison.json` shows to be *less* complete than filesets
written directly in Nix — they miss the root manifest and `pnpm-workspace.yaml`.
With one build and one test target per project, this workspace's task graph is
very nearly its project graph relabelled. Worth actually building for a
workspace with several targets per project, where that stops being true.

**E. Nx test atoms become Nix derivations.** The one place Nx supplies
something genuinely not derivable from the manifests: the per-test-file split,
which Nx gets by asking Vitest. It costs 18% on rebuilding everything and
barely improves invalidation, so it earns its place only where per-file
parallelism buys something a package-level task cannot — a package whose test
files differ a lot in runtime, so the slow ones stop queueing behind the fast
ones. It adds the enumeration hazard, so only with the guard in place. And if
outputs are pushed to a binary cache, count the extra derivations: a
post-build upload hook charges roughly 2 s each.

### Verdict

**A, on a pnpm workspace with isolated linking. Reach for E only where a
package's test files are unevenly slow, and for C only if a precondition below
fails.**

Concretely: derive the graph from the manifests during evaluation; one `tsc`
derivation and one Vitest derivation per package; precise filesets for the
build and the whole project directory for the test; recover the dev/runtime
split from the manifest sections; give each build output its own
`node_modules`; delete positional artifacts from outputs; and keep the three
guards, because a graph Nix inferred is a graph that can silently go stale.

Nx's remaining role in that recommendation is **nothing**, unless you want
per-file atomization. That is a stronger claim than this document made a day
ago, and it rests on `results/nx-dependency-levels.json`: of the 126 files Nx
tracks, 16 carry dependency information and all 16 are `package.json`. None of
the 88 TypeScript files carries any. In a pnpm workspace Nx knows dependencies
at exactly one level, and derives them from the same manifests Nix can read
directly.

## Scale: evaluation is not the constraint

Criterion 2 was "evaluates quickly", and evaluation was the one cost that
plausibly grew with the workspace: it happens on every invocation, before any
build. `scripts/measure-scale.mjs` generates synthetic workspaces with the same
dependency shapes and times evaluation with every build and test derivation
forced.

| projects | derivations | evaluation (median) | ms per project |
|---:|---:|---:|---:|
| 24 | 48 | 107 ms | 4.5 |
| 48 | 96 | 114 ms | 2.4 |
| 97 | 194 | 116 ms | 1.2 |
| 195 | 390 | 128 ms | 0.7 |
| 389 | 778 | 148 ms | 0.4 |

**Sixteen times the projects costs about 1.4× the evaluation.** Marginal cost
is roughly 0.11 ms per project, and per-project cost falls by an order of
magnitude across the range — the signature of a fixed cost dominating.

Checked against the measurement mistakes this document has already made:
forcing all 778 build and test derivation paths on a never-evaluated workspace
takes 150 ms cold against 148 ms warm, so no evaluation cache is being
measured; and forcing all 1950 attributes, including the per-test-file
variants, takes 144 ms, the same within noise. The first evaluation of a given
content also copies each project's fileset into the store, and that is the max
column: 179 ms at 389 projects.

Nothing is built or installed for this measurement. A fixed-output derivation's
path depends only on its name and hash, so the pnpm dependency closure
evaluates without being fetched.

So evaluation is comfortable to at least 400 projects, and the thing to watch
at that size is not evaluation but derivation count against whatever runs after
it — a per-derivation post-build hook above all.

## Preconditions: what this recipe assumes about a repository

The recommendation above is conditional, and these are the conditions. Each has
a check that takes one command, and a consequence if it fails.

### 1. pnpm with isolated linking

*Why it matters:* the whole case for architecture A is that the manifests are
the graph. That holds because pnpm links only a package's declared
dependencies, so an undeclared import does not resolve — it is a hard build
error rather than a missing edge.

*Check:* `pnpm config get node-linker` (and `nodeLinker` in
`pnpm-workspace.yaml`). Expect `isolated`, the default.

*If it fails:* under `hoisted`, phantom imports resolve, the manifests
under-report, and Nix would generate a graph that is missing real edges —
silently. Switch to architecture C: generate the table from Nx and drop it at
`nix/projects.json`.

### 2. Workspace edges come from package boundaries, not path aliases

*Why it matters:* if a project reaches into another through a `tsconfig`
`paths` alias rather than a dependency, no manifest records the edge.

*Check:* `grep -r '"paths"' tsconfig*.json packages/*/tsconfig.json` and see
whether any mapping points outside its own project.

*If it fails:* the manifests are not the graph. Architecture C, and verify Nx
actually reports those edges — in this workspace it reported *none* for a
cross-package alias (`results/correctness-probes.json`), so confirm before
relying on it.

### 3. Tests import source, not the built output

*Why it matters:* the test derivations here do not depend on their own
package's build, which is a real precision win — but only because the tests
import `../src/…` directly.

*Check:* grep the test files for imports of the package's own name.

*If it fails:* add the package's own build to its test derivation's inputs. Cost
is one extra edge per package, no loss of correctness.

### 4. One build and one test target per project

*Why it matters:* it is what makes the task graph redundant with the project
graph, and what keeps the derivation count at 2N.

*Check:* `nx show project <name> --json | jq '.targets | keys'` on a few
projects.

*If it fails:* more targets per project is where architecture D might earn its
place. It was never built here, so treat it as unexplored rather than rejected.

### 5. No generated sources, or they are committed

*Why it matters:* Nix's filesets come from the git tree, and so does Nx's file
index. Neither sees an uncommitted generated file.

*Check:* look for a codegen step in the build scripts.

*If it fails:* either commit the generated sources or generate them inside the
derivation. An uncommitted generated import fails loudly
(`results/correctness-probes.json`), so this cannot pass silently — but it will
stop the build.

### 6. `tsc` is the builder

*Why it matters:* the build derivations run `tsc -p tsconfig.json` and treat
`dist/` as the output.

*Check:* the `build` script in a package manifest.

*If it fails:* substitute the real builder. Keep two things: the precise
fileset, which is only justified while the builder declares its inputs, and
the deletion of positional artifacts such as source maps, without which
content-addressed early cutoff cannot work.

### 7. Whether a post-build hook uploads to a cache

*Why it matters:* not a correctness precondition, but the largest single cost
found in this experiment, and it is charged per derivation, so it interacts
directly with the granularity choice.

*Check:* `nix config show post-build-hook`.

*If it is set:* count derivations before choosing a finer granularity. On this
machine it cost roughly 2 s each, which is more than everything else a
derivation does put together.

## Does it compose?

The question the brief asked was whether Nx's semantic graph plus Nix's
reproducible derivation model is more powerful than either alone. For a pnpm
workspace the answer is that the question dissolves: there is no semantic graph
to add, because Nx's graph *is* the manifests, and Nix can read those.

Where the two do meet, they do not fight. They answer different questions — Nx
answers "what depends on what", once, offline; Nix answers "what must be
rebuilt", every time, from content — and feeding the first into the second
worked, producing derivations identical to deriving it directly.

The caveat applies to whichever route you take, because **a graph Nix inferred
is still an inference, and wrong inferences are silent.** Whether the table
comes from Nx and is checked in, or from the manifests during evaluation, the
failure direction is the same: fewer tests, all green. That is what the guards
are for, and it takes three separate checks because the question has three
parts. Deriving the graph in the evaluator removes one class of staleness — a
generated file nobody regenerated — and relocates the rest to the workspace
globs Nix restates because it cannot read YAML.

## Loose ends

- Content-addressed derivations remain untested: the daemon on this machine
  does not have `ca-derivations` enabled and enabling it is a system change.
  The prerequisite is now in place — see the section above — so the experiment
  is a few attributes away for anyone whose daemon allows it.
- The remaining per-unit gap, 1.20 s against Nx's 0.88 s, of which roughly half
  is Nix evaluation rather than work. Sharing the workspace skeleton was
  examined and rejected on measurement; see the cost section.
- Whether that per-unit gap matters in practice, given that Nix wins on every
  aggregate case. It is the number an editor-driven loop hits, so probably yes,
  and roughly half of it is evaluation rather than work.
- The scaling measurement is synthetic. It has the right dependency shapes and
  the right project count, but every generated package is small and similar. A
  real workspace with uneven package sizes and deeper import graphs could
  evaluate differently, though the flatness of the curve — dominated by fixed
  cost — suggests not by much.
- A from-source build including the toolchain was considered and **not**
  measured, deliberately. It would mean building into a throwaway store under
  `--store /tmp/...`, and the number would be dominated by populating that
  store with Node, stdenv and the 341-package pnpm dependency closure — none of
  which is what this experiment asks about. The "every unit rebuilt" row in the
  cost table already answers the useful version: every derivation this repo
  defines, rebuilt from a state where none of them existed. What is missing is
  only the one-off cost of a machine that has never seen the toolchain, and
  that is a property of Nix in general rather than of testing granularity.
- Architecture D, the Nx task graph becoming Nix derivations, is argued against
  from the shape of the data rather than measured. It was never built, and the
  case for building it is a workspace with several targets per project.
