# Prototype 3: one derivation per test file rather than per package.
#
# Two variants, because the interesting question is not whether Nix can run one
# file per derivation (it obviously can) but what each derivation is allowed to
# depend on:
#
#   perFile       the whole tests directory is an input, one file is run.
#                 Execution is split; invalidation is not, so editing any test
#                 file in a package reruns every one of that package's files.
#
#   perFileNarrow only the one test file is an input. Invalidation is split too,
#                 but the derivation no longer contains sibling test helpers or
#                 setup files, so a package whose tests share code cannot use
#                 it.
#
# Both variants trust nix/projects.json's enumeration of test files. That
# enumeration is the only place this design can fail silently: a test file
# missing from the list simply gets no derivation, and the remaining
# derivations all pass. `guards` below is the check that closes that hole.
{ lib
, stdenvNoCC
, nodejs
, workspace
}:
let
  repoRoot = ../.;

  table = builtins.fromJSON (builtins.readFile ./projects.json);

  sharedFiles = [
    (repoRoot + "/tsconfig.base.json")
    (repoRoot + "/vitest.shared.ts")
  ];

  projectPath = project: suffix: repoRoot + "/${project.root}/${suffix}";

  ownFiles = project: [
    (projectPath project "package.json")
    (projectPath project "tsconfig.json")
    (projectPath project "src")
    (projectPath project "vitest.config.ts")
  ];

  toSource = name: fileset: lib.fileset.toSource
    {
      root = repoRoot;
      inherit fileset;
    } // { inherit name; };

  attrFor = attr: testFile:
    "${attr}--${lib.replaceStrings [ "/" "." ] [ "-" "-" ] testFile}";

  mkTestFile = { builds }: variant: attr: project: testFile:
    let
      fileset = lib.fileset.unions (sharedFiles ++ ownFiles project ++ [
        (if variant == "narrow"
        then projectPath project testFile
        else projectPath project "tests")
      ]);
    in
    stdenvNoCC.mkDerivation {
      name = "nx-exp-${attrFor attr testFile}-test";
      src = toSource "nx-exp-${attrFor attr testFile}-src" fileset;
      nativeBuildInputs = [ nodejs ];
      dontPatchELF = true;
      dontStrip = true;

      buildPhase = ''
        runHook preBuild

        export HOME=$TMPDIR
        export CI=true
        ln -s ${workspace.nodeModules}/node_modules ./node_modules
        mkdir -p ${project.root}/node_modules/@nx-exp
        ${lib.concatMapStringsSep "\n"
          (dep: ''ln -sfn ${builds.${dep}} ${project.root}/node_modules/@nx-exp/${dep}'')
          (project.runtimeDeps ++ project.devDeps)}

        vitest=$PWD/node_modules/.bin/vitest
        cd ${project.root}
        set -o pipefail
        "$vitest" run ${testFile} --reporter=default 2>&1 | tee $TMPDIR/test.log

        runHook postBuild
      '';

      installPhase = ''
        runHook preInstall
        mkdir -p $out
        cp $TMPDIR/test.log $out/test.log
        runHook postInstall
      '';
    };

  # Asks Vitest which files it would run and fails if that disagrees with the
  # enumeration the per-file derivations were generated from. Without this, a
  # test file absent from nix/projects.json is simply never run and nothing
  # reports a problem.
  mkGuard = { builds }: attr: project: stdenvNoCC.mkDerivation {
    name = "nx-exp-${attr}-test-enumeration";
    src = toSource "nx-exp-${attr}-enumeration-src" (lib.fileset.unions
      (sharedFiles ++ ownFiles project ++ [ (projectPath project "tests") ]));
    nativeBuildInputs = [ nodejs ];
    dontPatchELF = true;
    dontStrip = true;

    expected = lib.concatStringsSep "\n" project.testFiles;

    buildPhase = ''
      runHook preBuild

      export HOME=$TMPDIR
      export CI=true
      ln -s ${workspace.nodeModules}/node_modules ./node_modules
      mkdir -p ${project.root}/node_modules/@nx-exp
      ${lib.concatMapStringsSep "\n"
        (dep: ''ln -sfn ${builds.${dep}} ${project.root}/node_modules/@nx-exp/${dep}'')
        (project.runtimeDeps ++ project.devDeps)}

      vitest=$PWD/node_modules/.bin/vitest
      node_bin=$(command -v node)
      cd ${project.root}
      "$vitest" list --filesOnly --json > $TMPDIR/discovered.json

      "$node_bin" -e '
        const { readFileSync } = require("node:fs")
        const discovered = JSON.parse(readFileSync(process.env.TMPDIR + "/discovered.json", "utf8"))
          .map((entry) => entry.file.slice(process.cwd().length + 1))
          .sort()
        const expected = process.env.expected.split("\n").filter(Boolean).sort()
        const missing = expected.filter((f) => !discovered.includes(f))
        const extra = discovered.filter((f) => !expected.includes(f))
        if (missing.length || extra.length) {
          console.error("test file enumeration disagrees with nix/projects.json")
          if (extra.length) console.error("  vitest runs these, no derivation exists: " + extra.join(", "))
          if (missing.length) console.error("  a derivation exists, vitest does not run: " + missing.join(", "))
          process.exit(1)
        }
        console.log("enumeration agrees: " + discovered.length + " test files")
      ' | tee $TMPDIR/guard.log

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p $out
      cp $TMPDIR/guard.log $out/guard.log
      runHook postInstall
    '';
  };

  perProject = f: lib.concatMapAttrs
    (attr: project: lib.listToAttrs (map
      (testFile: {
        name = attrFor attr testFile;
        value = f attr project testFile;
      })
      project.testFiles))
    table.projects;
in
{ builds }:
{
  perFile = perProject (mkTestFile { inherit builds; } "conservative");
  perFileNarrow = perProject (mkTestFile { inherit builds; } "narrow");
  guards = lib.mapAttrs (mkGuard { inherit builds; }) table.projects;
}
