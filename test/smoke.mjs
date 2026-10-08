// Offline smoke test for the stdio server: no dependencies, no network.
// node test/smoke.mjs   (from the repository root)
//
// Every outbound request is refused by a preload, so a check that reached the network
// fails here rather than passing on a live answer.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "bin", "lodestar-stamp-mcp.js");
const TOOLS = [
  "get_receipt",
  "batch_receipts",
  "find_business",
  "list_markets",
  "list_index",
  "list_sources",
  "list_gaps",
];
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

let failures = 0;
function check(ok, what) {
  if (ok) {
    console.log(`ok   ${what}`);
  } else {
    failures += 1;
    console.log(`FAIL ${what}`);
  }
}

const read = (path) => readFileSync(join(ROOT, path), "utf8");

const offline = join(mkdtempSync(join(tmpdir(), "stamp-smoke-")), "offline.cjs");
writeFileSync(
  offline,
  `const https = require("node:https");
https.request = () => { throw new Error("smoke test: network refused"); };
https.get = https.request;
`
);

// One run of the server: the frames in, the replies out, keyed by id.
function run(messages, env = {}) {
  const input = messages.map((m) => JSON.stringify(m) + "\n").join("");
  const childEnv = { ...process.env };
  delete childEnv.LODESTAR_KEY;
  delete childEnv.LODESTAR_CONSUMER;
  Object.assign(childEnv, { NODE_OPTIONS: `--require=${offline}` }, env);
  const proc = spawnSync(process.execPath, [SERVER], { input, env: childEnv, timeout: 20000 });
  const stdout = proc.stdout.toString("utf8");
  const replies = new Map();
  for (const line of stdout.split("\n").filter(Boolean)) {
    const message = JSON.parse(line);
    replies.set(message.id, message);
  }
  return { replies, stdout, stderr: proc.stderr.toString("utf8"), status: proc.status };
}

// Versions: every pin names the same release.
const pkg = JSON.parse(read("package.json"));
const server = JSON.parse(read("server.json"));
const source = read("bin/lodestar-stamp-mcp.js");
const serverVersion = (source.match(/const SERVER_VERSION = "([^"]+)";/) || [])[1];
const dockerPin = (read("Dockerfile").match(/lodestar-stamp-mcp@([0-9][^\s"]*)/) || [])[1];
check(server.version === pkg.version, `server.json version ${server.version} is package.json ${pkg.version}`);
check(
  server.packages.every((p) => p.identifier === pkg.name && p.version === pkg.version),
  "server.json packages name this package at this version"
);
check(server.name === pkg.mcpName, "server.json name is package.json mcpName");
check(serverVersion === pkg.version, `SERVER_VERSION ${serverVersion} is package.json ${pkg.version}`);
check(dockerPin === pkg.version, `Dockerfile installs ${dockerPin}, package.json is ${pkg.version}`);

// Supply chain: nothing to install, one module, one host, HTTPS only.
check(!pkg.dependencies && !pkg.optionalDependencies, "no runtime dependencies");
const required = [...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
check(required.length === 1 && required[0] === "node:https", `requires only node:https (${required.join(", ")})`);
check(source.includes('const API_BASE = "https://api.lodestarindex.com/v1";'), "talks only to https://api.lodestarindex.com/v1");
check(!/\bfetch\(|\beval\(|new Function\(|child_process/.test(source), "no fetch, eval or child_process");

// The wire.
const wire = run([
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", clientInfo: { name: "smoke" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "ping" },
  { jsonrpc: "2.0", id: 4, method: "no/such/method" },
  { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_receipt", arguments: { domain: "a.com", phone: "3125550100" } } },
  { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "find_business", arguments: {} } },
]);
check(wire.status === 0, `exits cleanly when stdin closes (status ${wire.status})`);
check(!wire.stdout.startsWith("Content-Length"), "newline-delimited, no Content-Length framing");
const init = wire.replies.get(1);
check(init && init.result.serverInfo.name === "lodestar-stamp-mcp", "initialize names the server");
check(init && init.result.serverInfo.version === pkg.version, "initialize reports the package version");
check(init && PROTOCOL_VERSIONS.includes(init.result.protocolVersion), "initialize answers a protocol version MCP defines");
const listed = wire.replies.get(2);
const tools = listed ? listed.result.tools : [];
check(JSON.stringify(tools.map((t) => t.name)) === JSON.stringify(TOOLS), `tools/list is ${TOOLS.join(", ")}`);
for (const tool of tools) {
  check(
    typeof tool.description === "string" && tool.description.length > 0 &&
      tool.inputSchema && tool.inputSchema.type === "object" &&
      tool.annotations && tool.annotations.readOnlyHint === true && tool.annotations.destructiveHint === false,
    `${tool.name} is described, has an object schema and is marked read-only`
  );
}
check(JSON.stringify(wire.replies.get(3)) === JSON.stringify({ jsonrpc: "2.0", id: 3, result: {} }), "ping answers {}");
check(wire.replies.get(4) && wire.replies.get(4).error.code === -32601, "an unknown method is -32601");
check(/exactly one/.test((wire.replies.get(5) || { error: {} }).error.message || ""), "two identifiers are refused before any call");
check(/q is required/.test((wire.replies.get(6) || { error: {} }).error.message || ""), "find_business without q is refused before any call");
check(!wire.replies.has(undefined), "a notification is not answered");
check(!/network refused/.test(wire.stdout + wire.stderr), "nothing above reached for the network");

// A key that is not a key is refused before any call and never printed.
const badKey = 'lsk_not a key "x"';
const keyed = run(
  [{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_receipt", arguments: { domain: "a.com" } } }],
  { LODESTAR_KEY: badKey }
);
const refused = keyed.replies.get(1);
check(refused && refused.error && /LODESTAR_KEY/.test(refused.error.message), "a malformed LODESTAR_KEY is refused");
check(!(keyed.stdout + keyed.stderr).includes("not a key"), "the malformed key is never printed");

// A line that is not JSON is a parse error, not a crash.
const bad = spawnSync(process.execPath, [SERVER], {
  input: "{not json\n",
  env: { ...process.env, NODE_OPTIONS: `--require=${offline}` },
  timeout: 20000,
});
const parsed = bad.stdout.toString("utf8").trim();
check(bad.status === 0 && parsed && JSON.parse(parsed).error.code === -32700, "a line that is not JSON is -32700");

// The README documents every tool.
const readme = read("README.md");
check(TOOLS.every((name) => readme.includes(`\`${name}(`)), "README documents every tool");

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
