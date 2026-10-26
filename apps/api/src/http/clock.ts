import type { AppDeps } from "../app";

export function clockOf(deps: AppDeps): () => Date {
  return deps.clock ?? (() => new Date());
}
