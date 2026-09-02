final: _prev: {
  nxExperiment =
    let
      workspace = final.callPackage ./workspace.nix { };
      perPackage = final.callPackage ./per-package.nix { inherit workspace; };
    in
    {
      inherit (workspace) installInputs wholeManifests pnpmDeps nodeModules;
      inherit (perPackage) builds tests allTests;
    };
}
