#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, opcHome, resolveRepository } from "./opc.mjs";
import { hookDefinitions } from "./opc-hooks.mjs";

// Prepare only. Never modifies Codex configuration, trust, or project-local files.
const args = process.argv.slice(2);
const flag = name => args[args.indexOf(`--${name}`) + 1];
const root = flag("root");
const supplied = args.includes("--scopes") ? JSON.parse(readFileSync(flag("scopes"), "utf8")) : [{ root, repository: args.includes("--repository") ? flag("repository") : root ? resolveRepository(root, loadConfig()) : "", ...(args.includes("--kind") ? { kind: flag("kind") } : {}) }];
if (!Array.isArray(supplied) || !supplied.length) throw new Error("--scopes must contain a nonempty array");
const scopes = supplied.map(scope => {
  if (!scope.root || !existsSync(scope.root) || typeof scope.repository !== "string" || !scope.repository.trim()) throw new Error("Each scope needs an existing root and explicit repository identity");
  const mode = args.includes("--active") ? "active" : scope.mode || "probe";
  if (!["active", "probe"].includes(mode)) throw new Error("Unknown pilot mode");
  const normalized = { root: resolve(scope.root), repository: scope.repository, mode };
  if (scope.kind) normalized.kind = scope.kind;
  if (scope.sessions !== undefined) {
    if (!Array.isArray(scope.sessions) || scope.sessions.some(id => typeof id !== "string")) throw new Error("sessions must be a string array");
    normalized.sessions = scope.sessions;
  }
  if (args.includes("--session")) normalized.sessions = [flag("session")];
  return normalized;
});
const home = resolve(args.includes("--home") ? flag("home") : join(opcHome(), "hooks", "myopc-pilot"));
for (const scope of scopes) {
  const distance = relative(scope.root, home);
  if (!distance.startsWith("..") && !isAbsolute(distance)) throw new Error("Pilot runtime must stay outside every project root");
}
const bin = join(home, "bin");
mkdirSync(bin, { recursive: true });
for (const file of ["opc.mjs", "opc-hooks.mjs"]) copyFileSync(join(dirname(fileURLToPath(import.meta.url)), file), join(bin, file));
writeFileSync(join(home, "pilot.json"), JSON.stringify({ scopes }, null, 2));
const definitions = hookDefinitions(join(bin, "opc-hooks.mjs"), home);
writeFileSync(join(home, "codex-hooks.review.json"), JSON.stringify(definitions, null, 2));
// TOML profile template can be copied to CODEX_HOME/<name>.config.toml and
// explicitly selected with -p <name>. It does not activate normal sessions.
const toml = ["[hooks]", ...Object.entries(definitions.hooks).map(([event, groups]) => `${event} = [{ hooks = [{ type = "command", command = ${JSON.stringify(groups[0].hooks[0].command)}, commandWindows = ${JSON.stringify(groups[0].hooks[0].commandWindows)}, timeout = ${groups[0].hooks[0].timeout} }] }]`)].join("\n");
writeFileSync(join(home, "opc-myopc-pilot.config.toml"), toml + "\n");
console.log(JSON.stringify({ prepared: true, scopes, home, review: join(home, "codex-hooks.review.json"), activated: false }));
