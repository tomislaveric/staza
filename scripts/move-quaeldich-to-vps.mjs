import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const envFile = path.resolve(".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const [fileArgument, ...extraArguments] = process.argv.slice(2);
if (!fileArgument || extraArguments.length > 0) {
  throw new Error("Usage: npm run move:quaeldich2vps -- <path/to/GeoJSON>");
}

const sourceFile = path.resolve(fileArgument);
const sourceStats = await stat(sourceFile);
if (!sourceStats.isFile() || sourceStats.size === 0) {
  throw new Error(`GeoJSON file is missing or empty: ${sourceFile}`);
}

const payload = JSON.parse(await readFile(sourceFile, "utf8"));
if (
  typeof payload !== "object" ||
  payload === null ||
  Array.isArray(payload) ||
  payload.type !== "FeatureCollection" ||
  !Array.isArray(payload.features) ||
  payload.features.length === 0
) {
  throw new Error(`Expected a non-empty GeoJSON FeatureCollection: ${sourceFile}`);
}

const target = process.env.QUAELDICH_VPS_SSH_TARGET?.trim();
if (!target || !/^(?:[A-Za-z_][A-Za-z0-9_.-]*@)?[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(target)) {
  throw new Error(
    "Set QUAELDICH_VPS_SSH_TARGET to user@host or an SSH config alias before uploading."
  );
}

const port = process.env.QUAELDICH_VPS_SSH_PORT?.trim();
if (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
  throw new Error("QUAELDICH_VPS_SSH_PORT must be between 1 and 65535.");
}

const destination = `${target}:/opt/staza/data/quaeldich-sample.geojson`;
console.log(`Uploading ${payload.features.length} GeoJSON features to ${destination}.`);
console.log("The local source file will be kept; scp may prompt for the VPS password.");

const scpArguments = [];
if (port) scpArguments.push("-P", port);
scpArguments.push(sourceFile, destination);
const result = spawnSync("scp", scpArguments, { stdio: "inherit" });

if (result.error) throw result.error;
if (result.status !== 0) {
  const reason = result.status === null ? ` (${result.signal})` : ` with exit code ${result.status}`;
  throw new Error(`scp failed${reason}.`);
}

console.log("quäldich snapshot uploaded successfully.");
