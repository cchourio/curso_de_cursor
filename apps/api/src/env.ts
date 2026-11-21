import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { z } from "zod";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: resolve(repoRoot, ".env") });

const envSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.length === 0 ? undefined : value)),
  DEMO_USERNAME: z.string().min(1, "Debe tener al menos 1 carácter"),
  DEMO_PASSWORD: z.string().min(8, "Debe tener al menos 8 caracteres"),
  SESSION_SECRET: z.string().min(32, "Debe tener al menos 32 caracteres"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Variables de entorno inválidas: ${details}`);
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
