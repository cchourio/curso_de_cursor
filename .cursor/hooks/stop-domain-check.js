import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputLimit = 8000;

function readInput() {
  const raw = readFileSync(0, "utf8");
  if (raw.trim().length === 0) {
    return {};
  }
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    return {};
  }
  return parsed;
}

function run(commandLine) {
  const result = spawnSync(commandLine, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: true,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { code: result.status ?? 1, output };
}

const input = readInput();
if (input.status === "aborted") {
  process.stdout.write("{}");
  process.exit(0);
}

const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "packages/domain/package.json"), "utf8"));
const hasTestScript = typeof packageJson.scripts?.test === "string" && packageJson.scripts.test.length > 0;

const checks = [
  { line: "pnpm --filter @ff/domain typecheck", requiresTestScript: false },
  { line: "pnpm --filter @ff/domain test", requiresTestScript: true },
];

const sections = [];
let failed = false;
for (const check of checks) {
  const result = run(check.line);
  const missingTest = check.requiresTestScript && !hasTestScript;
  if (result.code !== 0 || missingTest) {
    failed = true;
  }
  const note = missingTest
    ? "\n@ff/domain no tiene script test: pnpm terminó en 0 sin ejecutar el evaluador."
    : "";
  sections.push(`$ ${check.line}\nexit ${result.code}\n${result.output}${note}`);
}

if (!failed) {
  process.stdout.write("{}");
  process.exit(0);
}

let details = sections.join("\n\n");
if (details.length > outputLimit) {
  details = details.slice(details.length - outputLimit);
}

process.stdout.write(
  JSON.stringify({
    followup_message: `El typecheck o los tests de @ff/domain fallaron. Corrígelos y déjalos en verde.\n\n${details}`,
  }),
);
