import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dataRoot = resolve(repoRoot, "data");

function readInput() {
  const raw = readFileSync(0, "utf8");
  if (raw.trim().length === 0) {
    return {};
  }
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || typeof parsed.command !== "string") {
    return {};
  }
  return parsed;
}

function allow() {
  process.stdout.write(JSON.stringify({ permission: "allow" }));
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      permission: "deny",
      user_message: reason,
      agent_message: reason,
    }),
  );
}

function stripQuotes(command) {
  return command.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " ");
}

function deletesDatabaseFile(command) {
  if (/\bdb:reset\b/.test(command)) {
    return true;
  }
  if (/src[/\\]cli[/\\]reset\.ts/.test(command)) {
    return true;
  }
  const isDelete = /(?:^|[\s;&|])(rm|del|erase|unlink|rmSync|Remove-Item|ri)\b/i.test(command);
  return isDelete && /\.db(?:-wal|-shm)?\b/i.test(command);
}

function isRecursiveForceDelete(command) {
  if (/(?:^|[\s;&|])rm\b/.test(command)) {
    const recursive = /(?:^|\s)-[A-Za-z]*r[A-Za-z]*\b/.test(command) || /--recursive\b/.test(command);
    const force = /(?:^|\s)-[A-Za-z]*f[A-Za-z]*\b/.test(command) || /--force\b/.test(command);
    if (recursive && force) {
      return true;
    }
  }
  if (/(?:^|[\s;&|])(Remove-Item|ri|rm)\b/i.test(command)) {
    const recursive = /(?:^|\s)-(?:Recurse|r)\b/i.test(command);
    const force = /(?:^|\s)-(?:Force|fo)\b/i.test(command);
    if (recursive && force) {
      return true;
    }
  }
  return /(?:^|[\s;&|])(del|erase|rmdir|rd)\b/i.test(command) && /(?:^|\s)\/s\b/i.test(command);
}

function isMigrationCommand(command) {
  return /\bdrizzle-kit\s+(push|migrate|drop)\b/.test(command) || /\bdb:(migrate|push)\b/.test(command);
}

function firstMatch(match) {
  if (match === null) {
    return undefined;
  }
  return match[1] ?? match[2] ?? match[3];
}

function extractUrl(command) {
  const inline = firstMatch(
    command.match(/(?:^|[\s;&|])(?:\$env:)?DATABASE_URL\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i),
  );
  if (inline !== undefined) {
    return inline;
  }
  const flag = firstMatch(command.match(/--url(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/));
  if (flag !== undefined) {
    return flag;
  }
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return undefined;
}

function isDevelopmentDatabase(url) {
  if (url === undefined || url.length === 0 || url === ":memory:" || url.includes("mode=memory")) {
    return true;
  }
  const lower = url.toLowerCase();
  if (lower.includes("staging") || lower.includes("production")) {
    return false;
  }
  if (
    lower.startsWith("libsql:") ||
    lower.startsWith("https:") ||
    lower.startsWith("http:") ||
    lower.startsWith("wss:")
  ) {
    return false;
  }
  if (!lower.startsWith("file:")) {
    return false;
  }
  let filePath = url.slice("file:".length);
  const queryIndex = filePath.indexOf("?");
  if (queryIndex !== -1) {
    filePath = filePath.slice(0, queryIndex);
  }
  filePath = filePath.replace(/^\/+/, "");
  try {
    filePath = decodeURIComponent(filePath);
  } catch {
    return false;
  }
  const resolved = resolve(filePath).replaceAll("\\", "/").toLowerCase();
  const allowed = dataRoot.replaceAll("\\", "/").toLowerCase();
  return resolved === allowed || resolved.startsWith(`${allowed}/`);
}

const input = readInput();
const command = input.command ?? "";
const visible = stripQuotes(command);

if (isRecursiveForceDelete(visible) || deletesDatabaseFile(visible)) {
  deny("Comando bloqueado: borraría archivos o la base de datos.");
  process.exit(0);
}

if (isMigrationCommand(visible) && !isDevelopmentDatabase(extractUrl(command))) {
  deny("Comando bloqueado: la migración o drizzle-kit push no apunta a la base de desarrollo.");
  process.exit(0);
}

allow();
