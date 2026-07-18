import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function safeStorageKey(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]/g, "-");
  if (safe.length === 0) {
    throw new Error("Storage key cannot be empty");
  }
  return safe;
}

/**
 * Small file-backed off-chain store for the PoC. In production this adapter can
 * be replaced by IPFS, cloud object storage, or a shared database.
 */
export class FileEvidenceStore {
  constructor(private readonly rootDirectory: string) {}

  async storeBytes(collection: string, key: string, value: Uint8Array): Promise<string> {
    const safeCollection = safeStorageKey(collection);
    const safeKey = safeStorageKey(key);
    const directory = path.join(this.rootDirectory, "generated", safeCollection);
    const outputPath = path.join(directory, safeKey);

    await mkdir(directory, { recursive: true });
    await writeFile(outputPath, value);
    return outputPath;
  }

  async storeJson(collection: string, key: string, value: unknown): Promise<string> {
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    return this.storeBytes(collection, key, bytes);
  }
}
