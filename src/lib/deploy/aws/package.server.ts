import { gunzipSync } from "node:zlib";
import type { ZipEntry } from "./zip";

type Package = { name: string; archive: string; version: string };

const PACKAGES: Package[] = [
  { name: "@1password/sdk", archive: "sdk", version: "0.5.0" },
  { name: "@1password/sdk-core", archive: "sdk-core", version: "0.5.0" },
];

function tarEntries(bytes: Uint8Array, folder: string): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start: number, size: number) =>
      new TextDecoder().decode(header.subarray(start, start + size)).replace(/\0.*$/, "");
    const name = text(0, 100).replace(/^package\//, "");
    const size = Number.parseInt(text(124, 12).trim() || "0", 8);
    const type = text(156, 1);
    const data = bytes.slice(offset + 512, offset + 512 + size);
    if (name && (type === "" || type === "0")) entries.push({ name: `${folder}/${name}`, content: data });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function download(pkg: Package): Promise<ZipEntry[]> {
  const url = `https://registry.npmjs.org/${pkg.name}/-/${pkg.archive}-${pkg.version}.tgz`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Could not obtain the pinned 1Password SDK artifact (${response.status})`);
  const archive = gunzipSync(new Uint8Array(await response.arrayBuffer()));
  return tarEntries(archive, `node_modules/${pkg.name}`);
}

export async function onePasswordPackages(): Promise<ZipEntry[]> {
  const packages = await Promise.all(PACKAGES.map(download));
  return packages.flat();
}