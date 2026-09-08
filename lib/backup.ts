import Database from "better-sqlite3";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getDataDirectory, getDb } from "./db";

export type DatabaseCheck = {
  ok: boolean;
  file: string;
  integrity: string;
  foreign_key_errors: unknown[];
  tables: Record<string, number>;
};

function tableCounts(db: Database.Database) {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
  return Object.fromEntries(names.map(({ name }) => [name, Number((db.prepare(`SELECT COUNT(*) AS count FROM \"${name.replaceAll('"', '""')}\"`).get() as { count: number }).count)]));
}

export function verifyDatabase(filePath: string): DatabaseCheck {
  const file = resolve(filePath);
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    db.pragma("foreign_keys = ON");
    const integrity = String(db.pragma("integrity_check", { simple: true }));
    const foreignKeyErrors = db.pragma("foreign_key_check") as unknown[];
    return { ok: integrity === "ok" && foreignKeyErrors.length === 0, file, integrity, foreign_key_errors: foreignKeyErrors, tables: tableCounts(db) };
  } finally {
    db.close();
  }
}

export async function backupDatabase(outputPath: string) {
  const destination = resolve(outputPath);
  if (existsSync(destination)) throw new Error(`备份文件已存在：${destination}`);
  mkdirSync(dirname(destination), { recursive: true });
  const source = getDb();
  await source.backup(destination);
  const check = verifyDatabase(destination);
  if (!check.ok) throw new Error(`备份校验失败：${JSON.stringify(check)}`);
  const sourceAssets = resolve(getDataDirectory(), "assets");
  const assetBackup = `${destination}.assets`;
  if (existsSync(sourceAssets)) cpSync(sourceAssets, assetBackup, { recursive: true, errorOnExist: true });
  return { ...check, assets: existsSync(assetBackup) ? countFiles(assetBackup) : 0, asset_directory: existsSync(assetBackup) ? assetBackup : null };
}

export async function restoreDatabase(inputPath: string, outputDirectory: string) {
  const sourcePath = resolve(inputPath);
  const destinationDirectory = resolve(outputDirectory);
  const destination = resolve(destinationDirectory, "myopc.sqlite");
  if (existsSync(destination)) throw new Error(`恢复目录已有数据库：${destination}`);
  const sourceCheck = verifyDatabase(sourcePath);
  if (!sourceCheck.ok) throw new Error(`源备份校验失败：${JSON.stringify(sourceCheck)}`);
  mkdirSync(destinationDirectory, { recursive: true });
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(destination);
  } finally {
    source.close();
  }
  const restored = verifyDatabase(destination);
  if (!restored.ok) throw new Error(`恢复后校验失败：${JSON.stringify(restored)}`);
  const sourceAssets = `${sourcePath}.assets`;
  const destinationAssets = resolve(destinationDirectory, "assets");
  if (existsSync(sourceAssets)) {
    if (existsSync(destinationAssets)) throw new Error(`恢复目录已有素材目录：${destinationAssets}`);
    cpSync(sourceAssets, destinationAssets, { recursive: true, errorOnExist: true });
  }
  return { source: sourceCheck, restored, assets: existsSync(destinationAssets) ? countFiles(destinationAssets) : 0 };
}

function countFiles(directory: string): number {
  return readdirSync(directory, { withFileTypes: true }).reduce((count, entry) => count + (entry.isDirectory() ? countFiles(join(directory, entry.name)) : 1), 0);
}

export function defaultBackupPath() {
  return resolve(getDataDirectory(), "backups", `myopc-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.sqlite`);
}
