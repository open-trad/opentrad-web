import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

export function fail(code, message = code, exitCode = 1) {
  const error = new Error(message);
  error.code = code;
  error.exitCode = exitCode;
  throw error;
}

export function isPathWithin(candidate, parent) {
  const path = relative(resolve(parent), resolve(candidate));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

export async function sha256File(path) {
  const handle = await open(path, "r");
  const hash = createHash("sha256");
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk);
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function treeEntries(root, current = root) {
  const names = await readdir(current);
  names.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  const entries = [];
  for (const name of names) {
    const path = resolve(current, name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) fail("PAUSE_RELEASE:WEB_SYMLINK_REJECTED", name, 78);
    if (info.isDirectory()) entries.push(...(await treeEntries(root, path)));
    else if (info.isFile()) entries.push({ path, name: relative(root, path).split(sep).join("/") });
    else fail("PAUSE_RELEASE:WEB_ENTRY_REJECTED", name, 78);
  }
  return entries;
}

export async function sha256Tree(root) {
  const hash = createHash("sha256");
  for (const entry of await treeEntries(resolve(root))) {
    const bytes = await readFile(entry.path);
    hash.update(`${entry.name}\0${bytes.byteLength}\0`, "utf8");
    hash.update(bytes);
  }
  return hash.digest("hex");
}

export async function atomicWrite(path, contents, mode = 0o600) {
  const target = resolve(path);
  const temporary = `${target}.tmp-${process.pid}`;
  await rm(temporary, { force: true });
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx", mode });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export function canonicalJson(value) {
  const order = (input) => {
    if (Array.isArray(input)) return input.map(order);
    if (input === null || typeof input !== "object") return input;
    return Object.fromEntries(
      Object.keys(input)
        .sort()
        .map((key) => [key, order(input[key])]),
    );
  };
  return `${JSON.stringify(order(value))}\n`;
}

export function sanitizeRelative(path, root) {
  const value = relative(resolve(root), resolve(path)).split(sep).join("/");
  return value === "" ? "." : value;
}
