const path = require("path");

/**
 * Create bundle task options for @minecraft/core-build-tasks.
 */
function bundleOptions(projectDir, entryPoint, externals = []) {
  return {
    entryPoint: path.join(projectDir, entryPoint),
    external: externals,
    outfile: path.resolve(projectDir, "./dist/scripts/main.js"),
    minifyWhitespace: false,
    sourcemap: true,
    outputSourcemapPath: path.resolve(projectDir, "./dist/debug"),
  };
}

/**
 * Create copy task options for @minecraft/core-build-tasks.
 */
function copyOptions(projectDir, projectName, opts = {}) {
  const { bpDir = "BP", rpDir = "RP", hasRp = true } = opts;
  const result = {
    copyToBehaviorPacks: [`./${bpDir}/${projectName}`],
    copyToScripts: ["./dist/scripts"],
  };
  if (hasRp) result.copyToResourcePacks = [`./${rpDir}/${projectName}`];
  return result;
}

/**
 * Create .mcaddon zip task options.
 */
function mcaddonOptions(projectDir, projectName, copyOpts, opts = {}) {
  const { outputName, bpDir = "BP", rpDir = "RP", hasRp = true } = opts;
  return {
    ...copyOpts,
    outputFile: `./dist/packages/${outputName}.mcaddon`,
  };
}

module.exports = { bundleOptions, copyOptions, mcaddonOptions };
