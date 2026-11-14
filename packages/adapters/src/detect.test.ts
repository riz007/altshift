import { describe, expect, it } from "vitest";
import { detectFromPackageJson } from "./detect.js";

describe("detectFromPackageJson", () => {
  it("prefers Nuxt over the Vite it depends on", () => {
    const result = detectFromPackageJson({ dependencies: { nuxt: "^4.0.0" }, devDependencies: { vite: "^7.0.0" } });
    expect(result?.framework).toBe("nuxt");
  });

  it("treats Hydrogen as a React Router app", () => {
    const result = detectFromPackageJson({ dependencies: { "@shopify/hydrogen": "2025.7.0" } });
    expect(result?.framework).toBe("react-router");
  });

  it("returns null when nothing matches", () => {
    expect(detectFromPackageJson({ dependencies: { express: "^5.0.0" } })).toBeNull();
  });
});
