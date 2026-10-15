// A bounded UTF-8 file read for the adapter's two inputs (`capabilities.json`
// and `installed_plugins.json`): never more than `maxBytes + 1` bytes are read,
// so an oversized file is refused without loading it. Imports only `node:*`
// (the `studio` CLI loads this module, so never the Agent SDK).
import { closeSync, openSync, readSync } from "node:fs";

/** What a bounded read found. `missing`: the file (or a parent directory) does not exist. */
export type BoundedRead =
  | { readonly kind: "ok"; readonly text: string }
  | { readonly kind: "missing" }
  | { readonly kind: "too_large" }
  | { readonly kind: "error"; readonly detail: string };

function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : err instanceof Error ? err.message : String(err);
}

/** Read `path` as UTF-8, refusing a file over `maxBytes`. Never throws. */
export function readBounded(path: string, maxBytes: number): BoundedRead {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (err) {
    const code = errorCode(err);
    return code === "ENOENT" || code === "ENOTDIR" ? { kind: "missing" } : { kind: "error", detail: code };
  }
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    let total = 0;
    for (;;) {
      const n = readSync(fd, buffer, total, buffer.length - total, null);
      if (n === 0) break;
      total += n;
      if (total > maxBytes) return { kind: "too_large" };
    }
    return { kind: "ok", text: buffer.subarray(0, total).toString("utf8") };
  } catch (err) {
    return { kind: "error", detail: errorCode(err) };
  } finally {
    try {
      closeSync(fd);
    } catch {
      // Nothing to do: the read already has its answer.
    }
  }
}
