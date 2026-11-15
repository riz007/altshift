import { defineConfig } from "tsup";

// One public package. The internal @ariamend/* packages are bundled in from source; everything
// else stays a real dependency, so installs get lockfile-pinned, integrity-checked copies.
export default defineConfig({
  entry: { cli: "src/index.ts", api: "src/api.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  splitting: true,
  noExternal: [/^@ariamend\//],
  dts: { entry: { api: "src/api.ts" } },
  esbuildOptions(options) {
    options.conditions = ["source", "import", "default"];
  },
});
