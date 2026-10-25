import { serve } from "@hono/node-server";
import { createDb, resolveDatabaseUrl, runMigrations } from "@ff/db";
import { createApp } from "./app";
import { env } from "./env";

const db = await createDb(resolveDatabaseUrl(env.DATABASE_URL));
await runMigrations(db);

serve({ fetch: createApp({ db }).fetch, port: env.API_PORT }, (info) => {
  console.log(`API escuchando en http://localhost:${info.port}`);
});
