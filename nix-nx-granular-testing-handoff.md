# Handoff: Prototype Nix + Nx + pnpm/Vitest Granular Testing

## Objective

Build a **large, realistic pretend TypeScript monorepo** using:

- **pnpm workspaces**
- **Nx**
- **Vitest**
- **Nix**

The purpose is to investigate whether **Nix can benefit from dependency/affected information already understood by Nx**, and whether we can make Nix build/test the repository at a substantially more granular level than "run all tests whenever anything changes."

This is a research/prototyping exercise, not production infrastructure.

The important constraint is:

> **Do not involve NixCI.**

The goal is specifically to understand the relationship between **Nix's dependency/build model** and **Nx's knowledge of a JavaScript monorepo**.

---

# 1. The problem to investigate

Imagine a large pnpm workspace:

```text
repo/
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── nx.json
├── packages/
│   ├── core/
│   ├── parser/
│   ├── compiler/
│   ├── runtime/
│   ├── utils/
│   ├── ...
│   └── dozens/hundreds more packages
└── apps/
    ├── web/
    ├── cli/
    └── ...
```

There are many Vitest tests distributed across packages.

The naive Nix model might result in something conceptually like:

```text
repository source
       │
       ▼
   all tests
```

or perhaps one derivation per package, but with insufficiently precise invalidation.

Nx, however, already understands relationships such as:

```text
parser
   │
   ▼
compiler
   │
   ▼
runtime
   │
   ├──► cli
   └──► web
```

If:

```text
packages/parser/src/tokenizer.ts
```

changes, Nx can determine that `parser`, `compiler`, `runtime`, `cli`, and `web` may be affected.

The central research question is:

> **Can Nix consume or exploit Nx's knowledge to construct a more granular and efficient build/test graph?**

---

# 2. Important conceptual distinction

Do **not** assume that Nx and Nix are competing implementations of the same thing.

Think of them as having different knowledge.

### Nx knows

- pnpm workspace projects
- package dependencies
- source/project relationships
- inferred project graph
- affected projects
- task graph
- task inputs
- Vitest test targets
- potentially atomized/split test execution

### Nix knows

- derivations
- explicit inputs
- dependency closures
- content-addressed/reproducible build semantics
- build environments
- store paths
- cached build results

The experiment should investigate whether:

```text
Nx knowledge
     │
     ▼
some translation/interface
     │
     ▼
Nix derivations
```

can be useful.

---

# 3. Build a genuinely large pretend monorepo

Do **not** make a tiny toy example like:

```text
foo → bar
```

It should be large enough that the benefits and failure modes become visible.

Target approximately:

- 50–100 packages initially
- optionally 150–300 if performance permits
- 5–15 apps
- several layers of dependencies
- some shared foundational packages
- some isolated packages
- some packages with many dependants
- some packages with no dependants
- realistic test distributions

For example:

```text
packages/
├── foundation/
├── logging/
├── config/
├── errors/
├── types/
├── collections/
├── strings/
├── dates/
├── math/
├── serialization/
├── transport/
├── http/
├── graphql/
├── database/
├── cache/
├── auth/
├── users/
├── permissions/
├── billing/
├── search/
├── notifications/
├── analytics/
├── parser/
├── lexer/
├── ast/
├── compiler/
├── optimizer/
├── runtime/
├── renderer/
├── components/
├── ...
```

The exact names don't matter.

What matters is creating a **nontrivial DAG**.

There should be:

```text
low-level packages
        ↓
mid-level packages
        ↓
domain packages
        ↓
applications
```

and also some cross-cutting dependencies.

---

# 4. Generate realistic source and tests

The packages don't need to implement genuinely useful functionality.

Generate deterministic TypeScript code with plausible relationships.

For example:

```text
packages/parser/
├── src/
│   ├── lexer.ts
│   ├── tokenizer.ts
│   ├── parser.ts
│   └── index.ts
├── tests/
│   ├── lexer.test.ts
│   ├── tokenizer.test.ts
│   └── parser.test.ts
├── package.json
└── vitest.config.ts
```

Tests should actually execute.

Avoid tests that merely contain:

```ts
expect(true).toBe(true)
```

Instead create deterministic calculations and assertions.

The goal isn't test quality; it's to have enough actual execution that test selection matters.

Make test runtimes somewhat heterogeneous:

```text
tiny tests:        ~10 ms
normal tests:      ~50–200 ms
expensive tests:   ~500 ms–several seconds
```

Don't make the entire experiment painfully slow, though.

---

# 5. Create several classes of dependencies

The generated repository should deliberately contain:

### Leaf packages

```text
A
```

### Linear dependencies

```text
A → B → C → D
```

### Fan-out

```text
       B
      /|\
     C D E
```

### Fan-in

```text
A ─┐
B ─┼→ D
C ─┘
```

### Diamond dependencies

```text
       A
      / \
     B   C
      \ /
       D
```

### Large shared dependency

```text
          ┌→ app1
core ─────┼→ app2
          ├→ app3
          ├→ app4
          └→ app5
```

These cases are important because affected analysis should behave differently for each.

---

# 6. Set up Nx properly

Use current Nx tooling and the normal pnpm integration.

Have Nx recognize the packages and Vitest targets.

Verify:

```bash
nx graph
```

and:

```bash
nx affected -t test
```

work correctly.

Export the graph to JSON where useful:

```bash
nx graph --file=graph.json
```

Also investigate the Nx task graph / task metadata APIs or JSON representations that expose:

- projects
- dependencies
- targets
- test tasks
- inputs
- task dependencies

Do not merely rely on screenshots of `nx graph`.

We want machine-readable information.

---

# 7. Establish the baseline

Before involving Nix, measure the Nx/Vitest situation.

Record:

```text
number of packages
number of test targets
number of test files
total test execution time
```

Then create representative changes.

For each change, record what Nx considers affected.

Examples:

### Change A — isolated leaf

```text
packages/foo/src/foo.ts
```

### Change B — heavily shared library

```text
packages/core/src/core.ts
```

### Change C — package test only

```text
packages/foo/tests/foo.test.ts
```

### Change D — package metadata

```text
packages/foo/package.json
```

### Change E — Vitest configuration

```text
packages/foo/vitest.config.ts
```

### Change F — shared configuration

```text
vitest.config.ts
```

### Change G — pnpm lockfile

```text
pnpm-lock.yaml
```

### Change H — README/documentation

```text
packages/foo/README.md
```

The point is to see how Nx's affected calculation behaves in practice.

---

# 8. Prototype 1 — Nix per-package test derivations

Start with the simplest Nix integration.

Create one Nix test target per package:

```text
foo-test
bar-test
baz-test
...
```

Conceptually:

```nix
foo-test = pkgs.runCommand ...;
```

or an appropriate derivation mechanism.

The exact Nix implementation is up to you.

The important property is:

> **Each package's tests should be independently buildable by Nix.**

For example:

```bash
nix build .#foo-test
nix build .#bar-test
```

should work independently.

Then create a simple bridge:

```text
nx affected
     │
     ▼
affected project names
     │
     ▼
corresponding Nix test attributes
```

For example, conceptually:

```bash
nx affected -t test ...
```

might yield:

```text
foo
compiler
runtime
```

and the experiment invokes:

```bash
nix build \
  .#foo-test \
  .#compiler-test \
  .#runtime-test
```

### Measure

Compare:

```text
all package tests
```

against:

```text
Nx affected package tests
```

for the representative changes.

This is the baseline experiment.

---

# 9. Prototype 2 — Let Nix perform the dependency graph itself

Now investigate whether we can encode the Nx dependency graph into Nix.

If Nx says:

```text
foo → bar
bar → baz
```

create corresponding relationships between Nix package/test derivations.

Investigate whether this provides useful behavior for:

- building
- invalidation
- dependency ordering
- parallelism
- caching

The key question:

> **Does importing the project graph into Nix give Nix useful incremental behavior without requiring Nx at execution time?**

Compare this with Prototype 1.

---

# 10. Prototype 3 — Nix derivation per test file

Go one level more granular.

Suppose:

```text
foo/
├── src/
│   ├── parser.ts
│   └── lexer.ts
└── tests/
    ├── parser.test.ts
    ├── lexer.test.ts
    └── integration.test.ts
```

Experiment with:

```text
foo-test-parser
foo-test-lexer
foo-test-integration
```

rather than:

```text
foo-test
```

This is important because the original problem specifically asks whether Vitest can be packaged **granularly**.

Investigate whether Nx already has enough information to make this practical, particularly its Vitest integration and test atomization/splitting capabilities.

Do not assume that test-file-level dependency inference is safe.

Document what information is actually available.

---

# 11. Prototype 4 — Nx task graph → Nix

Investigate Nx's task graph.

We want to answer:

> **Can an Nx task be treated as the conceptual input to a Nix derivation?**

For example:

```text
Nx task:

foo:test
```

with metadata such as:

```text
project = foo
target = test
inputs = ...
dependencies = ...
```

Investigate how much of this can be extracted programmatically.

Then prototype generating Nix definitions from that information.

Conceptually:

```text
Nx workspace
     │
     ▼
Nx graph/task metadata
     │
     ▼
generated .nix / JSON
     │
     ▼
Nix derivations
```

Do not worry initially about elegant code generation.

The point is to establish whether the information is sufficient.

---

# 12. Prototype 5 — Compare Nx task inputs with Nix inputs

This may be the most interesting experiment.

Nx has task input/hash concepts.

Investigate exactly what Nx considers an input to:

```text
foo:test
```

Then compare that to what Nix considers an input to:

```text
foo-test
```

Create a table such as:

| Input | Nx sees it? | Nix sees it? | Should affect test? |
|---|---:|---:|---:|
| foo/src/a.ts | yes | yes | yes |
| foo/tests/a.test.ts | yes | yes | yes |
| foo/README.md | ? | ? | probably no |
| foo/package.json | yes | yes | yes |
| pnpm-lock.yaml | ? | yes | depends |
| Node version | yes | yes | yes |
| Vitest config | yes | yes | yes |
| dependency source | ? | ? | yes |

This should expose where the two systems' models overlap and where they don't.

---

# 13. Important experiment: don't accidentally make Nix too coarse

A likely failure mode is:

```nix
src = ./.;
```

for every test derivation.

That effectively tells Nix:

> "Every test depends on the entire repository."

If every derivation has:

```text
repository/
```

as its input, then changing:

```text
packages/completely-unrelated/README.md
```

can invalidate every test derivation.

That defeats the purpose.

Therefore deliberately experiment with increasingly precise source inputs.

For example:

```text
whole repository
        ↓
package directory
        ↓
package source + tests
        ↓
precisely selected files
```

Measure the consequences.

---

# 14. Investigate the fundamental tension

One of the most important things to determine is:

> **Can Nx's affected calculation and Nix's content-addressed dependency model coexist cleanly, or are we trying to make one compensate for information that belongs in the other?**

Consider:

```text
foo → bar
```

and a change to:

```text
foo/src/x.ts
```

Nx says:

```text
foo affected
bar affected
```

But if the Nix derivation for `bar-test` doesn't contain `foo` as an input, Nix cannot independently know that `bar-test` should change.

Conversely, if `bar-test` includes all of `foo`, Nix may correctly invalidate it—but you might lose finer-grained test selection.

Explore this boundary explicitly.

---

# 15. Measure everything

For every prototype, collect:

### Repository-level

```text
number of packages
number of apps
number of dependencies
number of test files
```

### Change-level

```text
changed files
Nx affected projects
Nx affected test tasks
Nix derivations selected
Nix derivations invalidated
Nix derivations actually rebuilt
```

### Performance

```text
all-tests wall clock
affected-tests wall clock
Nix evaluation time
Nix build time
Vitest execution time
cache hit rate
```

The numbers don't need to be scientifically perfect.

We mainly want to see whether there are meaningful orders-of-magnitude differences.

---

# 16. Create a test matrix

Build a matrix something like:

| Change | All tests | Nx affected | Nix only | Nx → Nix |
|---|---:|---:|---:|---:|
| leaf source | 100% | ? | ? | ? |
| shared source | 100% | ? | ? | ? |
| test file | 100% | ? | ? | ? |
| package.json | 100% | ? | ? | ? |
| Vitest config | 100% | ? | ? | ? |
| lockfile | 100% | ? | ? | ? |
| README | 100% | ? | ? | ? |

And separately:

| Granularity | Number of Nix nodes | Evaluation cost | Test savings |
|---|---:|---:|---:|
| workspace | 1 | | |
| package | ~100 | | |
| test target | ~100 | | |
| test file | ~500+ | | |

This should make the trade-offs obvious.

---

# 17. Investigate correctness, not just speed

This is extremely important.

Do **not** conclude that a scheme is good simply because fewer tests run.

Construct deliberate cases such as:

```text
foo/src/a.ts
```

being consumed indirectly by:

```text
bar/tests/integration.test.ts
```

and see whether the proposed system recognizes the relationship.

Also test:

- transitive dependencies
- generated files
- package exports
- conditional exports
- TypeScript path aliases
- Vitest setup files
- shared test utilities
- shared Vitest configuration
- environment configuration
- package.json changes
- dependency version changes
- lockfile changes

If there is insufficient information to safely make something granular, **say so**.

A conservative system that runs a little too much is preferable to a system that silently omits necessary tests.

---

# 18. Investigate what Nx actually knows

Do not rely on assumptions about Nx.

Explicitly inspect its generated information.

Questions to answer:

1. How is the project graph constructed?
2. How are npm/pnpm package dependencies represented?
3. How are source imports represented?
4. What does `nx affected` actually calculate?
5. How are target dependencies represented?
6. What exactly are the inputs to a Vitest target?
7. Does Nx know dependencies at the individual test-file level?
8. What does Vitest atomization provide?
9. Can the relevant information be obtained through a stable API?
10. Is the information intended for external consumers, or is it an implementation detail?

Use current Nx documentation/source where appropriate rather than guessing.

---

# 19. Investigate what Nix can express

Likewise, explicitly investigate Nix's capabilities.

Questions:

1. Can a derivation cleanly represent one package's tests?
2. Can a derivation cleanly represent one test file?
3. How should source subsets be represented?
4. How do transitive derivation dependencies affect invalidation?
5. Can dynamically generated derivations be practical at 100–300 packages?
6. What happens to evaluation time with thousands of derivations?
7. How does Nix's caching interact with this granularity?
8. Can test results be represented as derivation outputs?
9. What is the practical cost of having hundreds/thousands of test derivations?
10. Does finer granularity actually improve Nix's reuse, or merely make evaluation/build orchestration more expensive?

---

# 20. Don't prematurely settle on an architecture

The purpose is exploration.

Possible outcomes include:

### A

```text
Nx affected
    ↓
select Nix package-test derivations
```

is excellent and simple.

### B

```text
Nx project graph
    ↓
generate Nix graph
```

is worthwhile.

### C

```text
Nx task graph
    ↓
Nix derivations
```

is substantially better.

### D

Test-file granularity is not worth the complexity.

### E

Nix's own dependency model already gives most of the benefit if derivations are structured correctly.

### F

Nx has valuable information that Nix cannot otherwise cheaply obtain.

### G

The two systems' models don't compose cleanly enough to justify integration.

All of these are valid conclusions.

---

# 21. Deliverables

At the end, produce:

## 1. Reproducible repository

A repository containing:

```text
pnpm workspace
Nx
Vitest
Nix
generated large dependency graph
```

with instructions to reproduce the experiments.

## 2. Experiment scripts

For example:

```text
scripts/
├── generate-repo.ts
├── show-nx-graph.ts
├── affected-to-nix.ts
├── generate-nix-tests.ts
├── benchmark.ts
└── mutate-repo.ts
```

Names are illustrative.

## 3. Nix implementations

Keep the different approaches separate:

```text
nix/
├── baseline.nix
├── per-package.nix
├── per-test-file.nix
├── nx-generated.nix
└── ...
```

## 4. Benchmark results

Put results into something machine-readable, e.g.:

```text
results/
├── baseline.json
├── per-package.json
├── per-test-file.json
└── nx-to-nix.json
```

## 5. Written findings

Create:

```text
FINDINGS.md
```

It should answer:

> **What does Nx know that Nix doesn't?**

> **Which of that information is useful to Nix?**

> **At what granularity is it useful?**

> **How difficult is it to transfer that information?**

> **Does transferring it produce meaningful performance/caching improvements?**

> **What would a practical implementation look like?**

---

# 22. The most important final comparison

Ultimately I want a comparison between these conceptual architectures:

```text
A. Nix alone

source
  ↓
Nix dependency analysis
  ↓
test derivations
```

```text
B. Nx selects Nix

source changes
  ↓
Nx affected
  ↓
Nix test derivations
```

```text
C. Nx graph becomes Nix graph

Nx project graph
  ↓
generated Nix dependencies
  ↓
Nix test derivations
```

```text
D. Nx tasks become Nix derivations

Nx task graph
  ↓
Nix derivations
  ↓
granular test execution
```

```text
E. Nx test atoms become Nix derivations

Nx/Vitest test atoms
  ↓
Nix derivations
  ↓
individual test execution
```

The experiment should establish **where the sweet spot is**.

---

# 23. Guiding principle

The prototype should preserve this distinction:

> **Nx is allowed to know things about the JavaScript ecosystem that Nix does not know.**

Don't try to reproduce all of Nx inside Nix.

The interesting question is whether we can take advantage of the fact that Nx has already done expensive semantic analysis of the repository.

In particular, investigate whether:

```text
Nx's semantic graph
        +
Nix's reproducible derivation/cache model
```

is more powerful than either system operating independently.

The first useful result may be extremely simple:

```text
nx affected -t test
        ↓
select Nix derivations
```

But don't stop there. The purpose of the prototype is to determine whether **Nx's richer graph/task/input information can make Nix's model substantially more granular**, and where the practical limits are.
