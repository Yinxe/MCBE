import * as path from "path";

// ─── Types ──────────────────────────────────────────────────────

export interface BundleParams {
  entryPoint: string;
  external: string[];
  outfile: string;
  minifyWhitespace: boolean;
  sourcemap: boolean;
  outputSourcemapPath: string;
}

export interface CopyParams {
  copyToBehaviorPacks: string[];
  copyToScripts: string[];
  copyToResourcePacks?: string[];
}

export interface CopyOptions {
  bpDir?: string;
  rpDir?: string;
  hasRp?: boolean;
}

// ─── Functions ──────────────────────────────────────────────────

/** Create bundle task options for @minecraft/core-build-tasks. */
export function bundleOptions(
  projectDir: string,
  entryPoint: string,
  externals: string[] = []
): BundleParams {
  return {
    entryPoint: path.join(projectDir, entryPoint),
    external: externals,
    outfile: path.resolve(projectDir, "./dist/scripts/main.js"),
    minifyWhitespace: false,
    sourcemap: true,
    outputSourcemapPath: path.resolve(projectDir, "./dist/debug"),
  };
}

/** Create copy task options for @minecraft/core-build-tasks. */
export function copyOptions(
  projectDir: string,
  projectName: string,
  opts: CopyOptions = {}
): CopyParams {
  const { bpDir = "BP", hasRp = true } = opts;
  const result: CopyParams = {
    copyToBehaviorPacks: [`./${bpDir}/${projectName}`],
    copyToScripts: ["./dist/scripts"],
  };
  if (hasRp) result.copyToResourcePacks = [`./${opts.rpDir ?? "RP"}/${projectName}`];
  return result;
}
