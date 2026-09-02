# One build derivation and one test derivation per package, wired together with
# real Nix dependency edges. The graph comes from nix/graph.nix, which derives
# it from the workspace manifests during evaluation: no Nx, no generated file,
# and no import-from-derivation.
#
# Each derivation's source is narrowed to the files that target actually reads,
# so an edit under packages/foo cannot invalidate packages/bar's test.
{ lib
, stdenvNoCC
, nodejs
, support
}:
let
  inherit (support) table repoRoot projectPath sharedBuildFiles sharedTestFiles
    toSource prepareTree linkDepsInto runVitest installLog;

  # The build reads the manifest, the tsconfig and src; not tests, not the
  # vitest config, not the README.
  buildFileset = project: lib.fileset.unions (sharedBuildFiles ++ [
    (projectPath project "package.json")
    (projectPath project "tsconfig.json")
    (projectPath project "src")
  ]);

  # The test gets the whole project directory, and that is not laziness.
  #
  # A tsconfig states which files tsc reads, so the build's inputs can be named
  # precisely. A Vitest config is a program: it can pull in setup files, global
  # setup, fixtures, snapshot directories and custom reporters from anywhere
  # under the project, and none of that is visible to whoever writes the
  # fileset. Naming `src`, `tests` and `vitest.config.ts` was an assumption
  # about what Vitest reads, and it was wrong the first time it was tested — a
  # `setupFiles: ['./test-setup.ts']` in packages/orphan broke the derivation
  # with "Cannot find module .../test-setup.ts".
  #
  # The cost is real and shows up in the change matrix: a README edit now
  # invalidates that package's test, where the narrower fileset ignored it. That
  # was never precision, only an unsound guess.
  testFileset = project: lib.fileset.unions (sharedTestFiles ++ [
    (repoRoot + "/${project.root}")
  ]);

  mkBuild = attr: project: stdenvNoCC.mkDerivation {
    name = "nx-exp-${attr}-dist";
    src = toSource (buildFileset project);
    nativeBuildInputs = [ nodejs ];
    dontPatchELF = true;
    dontStrip = true;

    buildPhase = ''
      runHook preBuild

      ${prepareTree builds project project.runtimeDeps}

      tsc=$PWD/node_modules/.bin/tsc
      cd ${project.root}
      "$tsc" -p tsconfig.json

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p $out
      cp package.json $out/package.json
      cp -r dist $out/dist
      # Declaration maps let an editor jump from a .d.ts to the .ts it came
      # from. Nothing that consumes this output reads them: a dependent's tsc
      # reads the .d.ts and its Vitest reads the .js. They are also the only
      # part of the output that encodes source positions, so they are the only
      # reason a formatting-only edit changes it at all — which is exactly what
      # content-addressed early cutoff needs it not to do.
      find $out/dist -name '*.d.ts.map' -delete
      ${linkDepsInto builds "$out" project.runtimeDeps}

      runHook postInstall
    '';
  };

  # Tests run against the package's own sources and its dependencies' built
  # outputs, so a package's test does not depend on its own build at all.
  # Dev dependencies are edges of the test derivation only, which is why a
  # change to a test-only package does not invalidate anything downstream of
  # the packages that use it.
  mkTest = attr: project: stdenvNoCC.mkDerivation {
    name = "nx-exp-${attr}-test";
    src = toSource (testFileset project);
    nativeBuildInputs = [ nodejs ];
    dontPatchELF = true;
    dontStrip = true;

    buildPhase = ''
      runHook preBuild

      export CI=true
      ${prepareTree builds project (project.runtimeDeps ++ project.devDeps)}
      ${runVitest project ""}

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      ${installLog}
      runHook postInstall
    '';
  };

  builds = lib.mapAttrs mkBuild table.projects;
  tests = lib.mapAttrs mkTest table.projects;
in
{
  inherit builds tests;
  inherit (table) projects;

  # Everything at once, for the "run all tests" baseline.
  allTests = stdenvNoCC.mkDerivation {
    name = "nx-exp-all-tests";
    dontUnpack = true;
    dontBuild = true;
    installPhase = ''
      mkdir -p $out
      ${lib.concatMapStringsSep "\n"
        (attr: "cp ${tests.${attr}}/test.log $out/${attr}.log")
        (lib.attrNames tests)}
    '';
  };
}
