const { syncManifestVersion } = require("./version");
const { bundleOptions, copyOptions, mcaddonOptions } = require("./build-config");

module.exports = {
  syncManifestVersion,
  bundleOptions,
  copyOptions,
  mcaddonOptions,
};
