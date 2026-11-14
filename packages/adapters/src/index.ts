import { nuxtAdapter } from "./nuxt.js";
import type { FrameworkAdapter, FrameworkId } from "./types.js";

export * from "./detect.js";
export * from "./nuxt.js";
export * from "./types.js";
export * from "./vue-hints.js";

const ADAPTERS: readonly FrameworkAdapter[] = [nuxtAdapter];

export function adapterFor(framework: FrameworkId): FrameworkAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.id === framework);
}

/** The first adapter that recognises the repo, or undefined when the framework is not supported yet. */
export async function detectAdapter(repoRoot: string): Promise<FrameworkAdapter | undefined> {
  for (const adapter of ADAPTERS) {
    if ((await adapter.detect(repoRoot)) !== null) return adapter;
  }
  return undefined;
}
