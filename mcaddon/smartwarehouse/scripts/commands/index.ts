// ─── 命令注册中心 — 统一调用各命令的注册函数 ──────────
// 每个命令一个独立文件，在此统一导入和注册

import { StartupEvent } from "@minecraft/server";
import type { WarehouseService } from "../warehouse/WarehouseService";
import type { WarehouseRepository } from "../storage/WarehouseRepository";
import type { ModConfigStore } from "../storage/ModConfigStore";

import { registerCreate } from "./create";
import { registerResize } from "./resize";
import { registerRescan } from "./rescan";
import { registerDelete } from "./delete";
import { registerRescanPreview } from "./rescanPreview";
import { registerOrganize } from "./organize";
import { registerMenu } from "./menu";
import { registerSearch } from "./search";

export function registerAllCommands(
  event: StartupEvent,
  service: WarehouseService,
  repository: WarehouseRepository,
  configStore: ModConfigStore
): void {
  const registry = event.customCommandRegistry;

  registerCreate(registry, service);
  registerResize(registry, service);
  registerRescan(registry, service);
  registerDelete(registry, service);
  registerRescanPreview(registry, service);
  registerOrganize(registry);
  registerMenu(registry, service, repository, configStore);
  registerSearch(registry, repository, configStore);
}
