# Plan: does this survive at scale?

The one open question that can still change the verdict in
[FINDINGS.md](FINDINGS.md). Everything else is settled, blocked by this
machine's Nix daemon, or deliberately declined; see
[HANDOFF.md](HANDOFF.md).

## The question

Nix evaluation is about **0.6 s per invocation at 19 projects**, flat across
granularities, and roughly half the 1.20 s it costs to rebuild one isolated
unit. Everything else about architecture C looks good — Nix establishes that
19 projects are current in 68 ms against Nx's 467 ms, and rebuilds after a
real change faster than Nx does.

But evaluation happens on *every* invocation, before any build, and it is the
one cost that plausibly grows with the size of the workspace. So:

> **Does Nix evaluation time grow linearly with project count, or better?**

Linear at 0.6 s per 19 projects extrapolates to roughly 10 s per `nix build`
at 300 packages, which would make an editor-driven loop unpleasant and would
push the verdict towards keeping Nx in the execution path after all. Sublinear
or flat, and architecture C is settled.

Nothing else in the open list can move the recommendation, so this plan does
this and stops.

## Safety rules, restated

This file may be read on its own. The full reasoning is in HANDOFF.md.

- **Never** `nix store delete`, `nix store gc`, `nix store optimise`,
  `nix-collect-garbage`, or anything that walks `/nix/store/.links`. A previous
  session crashed this machine that way.
- Every build: `--max-jobs 4`. Never two build-heavy things at once.
- Every measurement: `--option post-build-hook ""`. This machine uploads each
  output to a shared cache at roughly 2 s per derivation, which swamps
  everything being measured.
- `df -h` before and between sizes.
- Prefer eval-only. Phase 2 below answers the question with no builds at all.

## Phase 1 — a generator, output untracked

The user deferred scale on purpose: theory first, hand-written packages. That
deferral is spent, because what remains is a scaling question.

Write `scripts/generate-scale-workspace.mjs`:

- deterministic, no clock or randomness that varies between runs;
- takes a project count and an output directory;
- emits the same DAG shapes as the hand-written workspace, in proportion — a
  heavily shared foundation, diamonds, fan-ins, chains of depth 3–5, some
  orphans, and at least one dev-only dependency, because that is where the two
  models diverge;
- emits real tests with real assertions, heterogeneous in cost, since a
  workspace of trivial tests would flatter every approach equally;
- writes into `scale/`, which is **gitignored**.

Its own flake under `scale/<n>/`, reusing the `nix/` expressions. Do not make
the main flake depend on generated content.

**Sizes: 25, 50, 100, 200, 300.**

Checkpoint: `nix flake check` still passes on the real workspace, and
`git status` is clean apart from the generator and a `.gitignore` line.

## Phase 2 — evaluation scaling, eval only

The whole question, and it needs no builds. At each size, three runs for
variance:

```bash
# in scale/<n>/
time nix eval --json .#packages.x86_64-linux \
  --apply 'set: builtins.listToAttrs (
    map (name: { inherit name; value = set.${name}.drvPath; })
      (builtins.filter (name: builtins.match "(build|test)-.*" name != null)
        (builtins.attrNames set)))'
```

Record per size: projects, derivations, evaluation ms (min/median/max of three).
Write to `results/scale.json` in the **real** repo, since it is a result worth
keeping, and cite it from FINDINGS.md.

Capture two more things cheaply at each size, because they scale too:

- **Nx's own graph construction**: `time node_modules/.bin/nx graph
  --file=/tmp/g.json` with `NX_DAEMON=false`. If Nx's analysis is what blows
  up, that matters for the bridge's regeneration cost even though it happens
  offline.
- **Bridge size**: line count and byte size of the generated
  `nix/projects.json`, which grows linearly by construction.

Then plot the shape — literally, or just read the ratios. Look at
ms-per-project across sizes: flat means linear total, rising means worse than
linear, falling means better.

**Decision point.** If evaluation at 300 projects is under ~2 s, architecture C
is settled and Phase 3 is a nice-to-have. If it is over ~5 s, that is the most
important result in the document: it goes in the headline of FINDINGS.md, not
the loose ends, and the verdict needs qualifying with a project-count ceiling
or a note that `nx affected` as a pre-filter earns its place after all
(architecture B, currently rejected as strictly worse than C).

Cost: seconds per measurement. Do this first, and the write-up is possible even
if nothing else gets done.

## Phase 3 — build cost at scale, only if Phase 2 says it survives

At the largest size that stays comfortable, with
`--option post-build-hook "" --max-jobs 4`:

- **rebuild every unit**: edit `vitest.shared.ts`, which invalidates every test
  derivation and no build derivation. This is the safe stand-in for a cold run;
  never delete from the store to force one.
- **rebuild after a shared-foundation edit**: a unique edit to the generated
  equivalent of `core/src/hash.ts`. Unique per run, or it reproduces
  derivations an earlier run already built and the measurement is cache hits.
- **`nix flake check` wall clock**, which at 300 projects is ~600 build and
  test derivations plus guards.

Watch `df -h` between sizes. Each size has its own `node_modules` and its own
`pnpmDeps` fixed-output derivation, and neither is small. If space or time
starts looking uncomfortable, stop and report the sizes that did complete —
a partial curve is still a curve.

## Phase 4 — write up

- Extend the granularity section of FINDINGS.md with the scaling curve.
- Settle or qualify the verdict.
- Move the "evaluation cost at scale" entry out of the open list, and say what
  replaced it.
- If the answer is uncomfortable, say so plainly. The cost section of that
  document has been wrong three times, each time in Nix's favour-by-omission,
  and each correction was worth more than the original claim.

## What not to do

- Do not scale the hand-written 19-project workspace. Its numbers are cited
  throughout FINDINGS.md and `results/`.
- Do not commit generated workspaces.
- Do not chase the per-unit 1.20 s further before there is a scaling answer.
  Half of it is evaluation at 19 projects, and whether that half grows is
  exactly what Phase 2 measures.
- Do not push. The commits are unpushed and authorisation was asked for twice
  and never given.
