// 在 system.run() 中安全执行回调，支持 async。
import { system } from "@minecraft/server";

export function runSafeAsync(fn: () => void | Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    system.run(() => {
      try {
        const ret = fn();
        if (ret instanceof Promise) {
          ret.then(resolve).catch(reject);
        } else {
          resolve();
        }
      } catch (e) {
        reject(e);
      }
    });
  });
}
