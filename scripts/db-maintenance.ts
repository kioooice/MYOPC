import { backupDatabase, defaultBackupPath, restoreDatabase, verifyDatabase } from "../lib/backup";
import { closeDbForTests } from "../lib/db";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const command = process.argv[2];
  if (command === "backup") {
    const report = await backupDatabase(argument("--output") || defaultBackupPath());
    console.log(JSON.stringify({ operation: "backup", ...report }, null, 2));
    return;
  }
  if (command === "verify") {
    const file = argument("--file");
    if (!file) throw new Error("用法：npm run db:verify -- --file <sqlite>");
    console.log(JSON.stringify({ operation: "verify", ...verifyDatabase(file) }, null, 2));
    return;
  }
  if (command === "restore") {
    const file = argument("--file");
    const directory = argument("--directory");
    if (!file || !directory) throw new Error("用法：npm run db:restore -- --file <sqlite> --directory <isolated-dir>");
    const report = await restoreDatabase(file, directory);
    console.log(JSON.stringify({ operation: "restore", ...report }, null, 2));
    return;
  }
  throw new Error("用法：npm run db:backup；npm run db:verify -- --file <sqlite>；npm run db:restore -- --file <sqlite> --directory <isolated-dir>");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => closeDbForTests());
