import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { env } from "./env";

serve({ fetch: createApp().fetch, port: env.API_PORT }, (info) => {
  console.log(`API escuchando en http://localhost:${info.port}`);
});
