// 极简 @minecraft/server mock:记录所有调用,便于断言转场是否真的驱动了相机
const calls = { setCamera: [], fade: [], clear: [], teleport: [], run: 0, interval: 0, perm: [], sound: [] };
let tick = 0;
const intervals = [];
const timeouts = [];

class Player {
  constructor(name = "tester") {
    this.name = name; this.id = "pid-1"; this.isValid = true; this.isSneaking = false;
    this.location = { x: 0, y: 64, z: 0 };
    this.dimension = { id: "minecraft:overworld" };
    this.camera = {
      setCamera: (preset, opts) => calls.setCamera.push({ preset, opts, tick }),
      fade: (o) => calls.fade.push({ o, tick }),
      clear: () => calls.clear.push({ tick }),
    };
    this.inputPermissions = {
      setPermissionCategory: (c, v) => calls.perm.push({ c, v, tick }),
    };
    this.playSound = (id, o) => calls.sound.push({ id, o, tick });
    this.teleport = (loc, opts) => {
      calls.teleport.push({ loc, opts, tick });
      this.location = { ...loc };
      if (opts && opts.dimension) this.dimension = opts.dimension;
    };
    this.getRotation = () => ({ x: 0, y: 0 });
  }
}
const world = {
  getDimension: (id) => ({ id, tickingAreaManager: { createTickingArea: () => Promise.resolve(), removeTickingArea: () => {} } }),
  tickingAreaManager: { createTickingArea: () => Promise.resolve(), removeTickingArea: () => {} },
  getDynamicProperty: () => undefined,
  setDynamicProperty: () => {},
  afterEvents: { playerLeave: { subscribe: () => {} }, entityDie: { subscribe: () => {} } },
};
const system = {
  get currentTick() { return tick; },
  run: (fn) => { calls.run++; timeouts.push(fn); return 0; },
  runTimeout: (fn, t) => { timeouts.push(fn); return 0; },
  runInterval: (fn, n) => { calls.interval++; intervals.push(fn); return 0; },
  clearRun: () => {},
};
const InputPermissionCategory = { Camera: 1, Movement: 2, LateralMovement: 4, Sneak: 5, Jump: 6, Mount: 7, Dismount: 8 };
const EasingType = { Linear: "Linear", OutSine: "OutSine" };
const CommandPermissionLevel = { Any: 0 };
const CustomCommandParamType = { String: "String" };
const CustomCommandSource = { Entity: 1 };
const CustomCommandStatus = { Success: 0, Failure: 1 };
module.exports = { Player, world, system, InputPermissionCategory, EasingType,
  CommandPermissionLevel, CustomCommandParamType, CustomCommandSource, CustomCommandStatus,
  __calls: calls, __advance: (n) => { for (let i=0;i<n;i++){ tick++; timeouts.splice(0).forEach(f=>f()); intervals.slice().forEach(f=>f()); } },
  __flushTimeouts: () => timeouts.splice(0).forEach(f=>f()) };
