#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { opcHome } from "./opc.mjs";
import { hookDefinitions } from "./opc-hooks.mjs";

// Prepare only. Never modifies Codex configuration, trust, or project-local files.
const args = process.argv.slice(2);
const flag = name => args[args.indexOf(`--${name}`) + 1];
const root = flag("root");
if (!root || !existsSync(root)) throw new Error("--root must name an existing isolated pilot directory");
const home = resolve(args.includes("--home") ? flag("home") : join(opcHome(), "hooks", "myopc-pilot"));
const distance = relative(resolve(root), home);
if (!distance.startsWith("..") && !isAbsolute(distance)) throw new Error("Pilot runtime must stay outside the project root");
const bin = join(home, "bin");
mkdirSync(bin, { recursive: true });
for (const file of ["opc.mjs", "opc-hooks.mjs"]) copyFileSync(join(dirname(fileURLToPath(import.meta.url)), file), join(bin, file));
const mode = args.includes("--active") ? "active" : "probe";
const scope = { root: resolve(root), repository: "kioooice/MYOPC", mode };
if (args.includes("--session")) scope.sessions = [flag("session")];
writeFileSync(join(home, "pilot.json"), JSON.stringify({ scopes: [scope] }, null, 2));
const definitions = hookDefinitions(join(bin, "opc-hooks.mjs"), home);
writeFileSync(join(home, "codex-hooks.review.json"), JSON.stringify(definitions, null, 2));
// TOML profile template can be copied to CODEX_HOME/<name>.config.toml and
// explicitly selected with -p <name>. It does not activate normal sessions.
const toml = ["[hooks]", ...Object.entries(definitions.hooks).map(([event, groups]) => `${event} = [{ hooks = [{ type = "command", command = ${JSON.stringify(groups[0].hooks[0].command)}, commandWindows = ${JSON.stringify(groups[0].hooks[0].commandWindows)}, timeout = ${groups[0].hooks[0].timeout} }] }]`)].join("\n");
writeFileSync(join(home, "opc-myopc-pilot.config.toml"), toml + "\n");
console.log(JSON.stringify({ prepared: true, mode, root: scope.root, home, review: join(home, "codex-hooks.review.json"), activated: false }));
