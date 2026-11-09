// ─── 版本号的唯一来源 ───────────────────────────────────────────
//
// 与 package.json#version 保持一致。打包脚本会同步 manifest 里的
// header.version 与 modules[].version,但脚本侧的日志版本无法自动注入,
// 因此单独放一个常量并在此处注明同步要求。
//
// ⚠ 升级版本时改三处:package.json#version、本文件、behavior_packs/teleporter/manifest.json
//    (manifest 的两处版本由 npm run pack 的 synchronizePackVersions 自动同步)

export const MOD_VERSION = "0.0.6";
