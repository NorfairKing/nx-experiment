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
# Both variants trust an enumeration of test files, which nix/graph.nix builds
# by walking the tests directory. That is an approximation of what Vitest would
# discover, and it is the only place this design can fail silently: a test file
# missing from the list simply gets no derivation, and the remaining
# derivations all pass. `guards` below asks Vitest itself and closes the hole.
#
# Per-package granularity avoids the problem entirely, because `vitest run`
# discovers its own files. That is one reason to prefer it.
{ lib
, stdenvNoCC
, nodejs
, support
}:
let
  inherit (support) table repoRoot projectPath sharedTestFiles toSource
    prepareTree runVitest installLog;

  # Everything under the project except its test files. A Vitest config can
  # read setup files and fixtures from anywhere under the project, so those have
  # to be present; only the sibling test files can safely be left out, and that
  # is what makes the narrow variant narrow.
  ownFilesWithoutTests = project: lib.fileset.difference
    (repoRoot + "/${project.root}")
    (projectPath project "tests");

  attrFor = attr: testFile:
    "${attr}--${lib.replaceStrings [ "/" "." ] [ "-" "-" ] testFile}";

  mkTestFile = builds: variant: attr: project: testFile:
    let
      fileset = lib.fileset.unions (sharedTestFiles ++ [
        (ownFilesWithoutTests project)
        (if variant == "narrow"
        then projectPath project testFile
        else projectPath project "tests")
      ]);
    in
    stdenvNoCC.mkDerivation {
      name = "nx-exp-${attrFor attr testFile}-test";
      src = toSource fileset;
      nativeBuildInputs = [ nodejs ];
      dontPatchELF = true;
      dontStrip = true;

      buildPhase = ''
        runHook preBuild

        export CI=true
        ${prepareTree builds project (project.runtimeDeps ++ project.devDeps)}
        ${runVitest project testFile}

        runHook postBuild
      '';

      installPhase = ''
        runHook preInstall
        ${installLog}
        runHook postInstall
      '';
    };

  # Asks Vitest which files it would run and fails if that disagrees with the
  # enumeration the per-file derivations were generated from. Without this, a
  # test file the enumeration missed is simply never run and nothing reports a
  # problem.
  mkGuard = builds: attr: project: stdenvNoCC.mkDerivation {
    name = "nx-exp-${attr}-test-enumeration";
    src = toSource (lib.fileset.unions
      (sharedTestFiles ++ [ (repoRoot + "/${project.root}") ]));
    nativeBuildInputs = [ nodejs ];
    dontPatchELF = true;
    dontStrip = true;

    expected = lib.concatStringsSep "\n" project.testFiles;

    buildPhase = ''
      runHook preBuild

      export CI=true
      ${prepareTree builds project (project.runtimeDeps ++ project.devDeps)}

      vitest=$PWD/node_modules/.bin/vitest
      node_bin=$(command -v node)
      cd ${project.root}
      "$vitest" list --filesOnly --json > $TMPDIR/discovered.json
      "$node_bin" ${checkEnumeration} $TMPDIR/discovered.json | tee $TMPDIR/test.log

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      ${installLog}
      runHook postInstall
    '';
  };

  checkEnumeration = builtins.toFile "check-enumeration.mjs" ''
    import { readFileSync } from 'node:fs'

    const discovered = JSON.parse(readFileSync(process.argv[2], 'utf8'))
      .map((entry) => entry.file.slice(process.cwd().length + 1))
      .sort()
    const expected = process.env.expected.split("\n").filter(Boolean).sort()

    const missing = expected.filter((file) => !discovered.includes(file))
    const extra = discovered.filter((file) => !expected.includes(file))

    if (missing.length > 0 || extra.length > 0) {
      console.error("test file enumeration disagrees with what Vitest would run")
      if (extra.length > 0) {
        console.error("  vitest runs these, no derivation exists: " + extra.join(", "))
      }
      if (missing.length > 0) {
        console.error("  a derivation exists, vitest does not run: " + missing.join(", "))
      }
      process.exit(1)
    }

    console.log("enumeration agrees: " + discovered.length + " test files")
  '';

  perProject = f: lib.concatMapAttrs
    (attr: project: lib.listToAttrs (map
      (testFile: {
        name = attrFor attr testFile;
        value = f attr project testFile;
      })
      project.testFiles))
    table.projects;
in
builds:
{
  perFile = perProject (mkTestFile builds "conservative");
  perFileNarrow = perProject (mkTestFile builds "narrow");
  guards = lib.mapAttrs (mkGuard builds) table.projects;
}
