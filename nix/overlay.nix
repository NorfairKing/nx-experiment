final: _prev: {
  nxExperiment =
    let
      workspace = final.callPackage ./workspace.nix { };
      perPackage = final.callPackage ./per-package.nix { inherit workspace; };
    in
    {
      inherit (workspace) manifests pnpmDeps nodeModules;
      inherit (perPackage) builds tests allTests;
    };
}
