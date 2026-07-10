const path = require("path");
const fs = require("fs");

/**
 * Sync package.json version to all BP/<proj>/manifest.json and RP/<proj>/manifest.json.
 *
 * @param {string} projectDir - Project root directory
 * @param {object} [opts]
 * @param {(name: string, version: string) => string} [opts.formatName]
 * @param {(manifest: any, dir: string, versionArr: number[]) => void} [opts.onManifest]
 */
function syncManifestVersion(projectDir, opts = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(projectDir, "package.json"), "utf8"));
  const version = pkg.version;
  const baseVersion = version.split(/[-+]/)[0];
  const versionArr = baseVersion.split(".").map(Number);
  const formatName = opts.formatName;

  for (const dir of ["BP", "RP"]) {
    const manifestDir = path.resolve(projectDir, dir);
    if (!fs.existsSync(manifestDir)) continue;

    const items = fs.readdirSync(manifestDir);
    for (const item of items) {
      const manifestPath = path.resolve(manifestDir, item, "manifest.json");
      if (!fs.existsSync(manifestPath)) continue;

      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.header.version = versionArr;

      if (manifest.header.name !== undefined && formatName) {
        manifest.header.name = formatName(manifest.header.name, version);
      }
      if (manifest.modules) {
        manifest.modules = manifest.modules.map((m) =>
          Array.isArray(m.version) ? { ...m, version: versionArr } : m
        );
      }
      if (manifest.dependencies) {
        manifest.dependencies = manifest.dependencies.map((d) =>
          d.uuid && Array.isArray(d.version) ? { ...d, version: versionArr } : d
        );
      }

      if (opts.onManifest) {
        opts.onManifest(manifest, dir, versionArr);
      }

      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    }
  }
}

module.exports = { syncManifestVersion };
