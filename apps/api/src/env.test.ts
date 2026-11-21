import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shortSecret = "zz-short";

describe("variables de sesión", () => {
  it("nombra SESSION_SECRET y no imprime el valor cuando falta o es corto", () => {
    expect(() => parseEnv({})).toThrow(/SESSION_SECRET/);
    expect(() =>
      parseEnv({
        DEMO_USERNAME: "demo",
        DEMO_PASSWORD: "demo-password",
        SESSION_SECRET: shortSecret,
      }),
    ).toThrow(/SESSION_SECRET/);

    try {
      parseEnv({
        DEMO_USERNAME: "demo",
        DEMO_PASSWORD: "demo-password",
        SESSION_SECRET: shortSecret,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(shortSecret);
    }
  });

  it("no arranca la API si SESSION_SECRET tiene menos de 32 caracteres", () => {
    const env = { ...process.env, DEMO_USERNAME: "demo", DEMO_PASSWORD: "demo-password", SESSION_SECRET: shortSecret };
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "await import('./src/env.ts')"], {
      cwd: apiRoot,
      env,
      encoding: "utf8",
    });
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain("SESSION_SECRET");
    expect(output).not.toContain(shortSecret);
    expect(output).not.toContain("API escuchando");
  });
});
