#!/usr/bin/env node
/**
 * @yinxe/toolkit version sync CLI
 *
 * Usage: sync-version [project-dir]
 *   If project-dir is omitted, uses cwd.
 */

const { syncManifestVersion } = require("../src/version");
const projectDir = process.argv[2] || process.cwd();
syncManifestVersion(projectDir);
console.log("✓ Version synced");
