#!/usr/bin/env node
/**
 * `mcwiki-search` 可执行入口。
 *
 * 只做 IO 绑定与版本读取；命令树、错误处理与退出码都在 `program.ts`，
 * 因此全部逻辑都可在单测中直接驱动，无需启动子进程。
 */

import { createRequire } from 'node:module';

import { runCli } from './program.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  isTTY: process.stdout.isTTY === true,
  setExitCode: (code) => {
    process.exitCode = code;
  },
  version,
});
