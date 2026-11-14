import type { Page } from "playwright";
import { VISUAL_CHANGE_EXPECTED } from "../rule-tiers.js";
import type { GateResult } from "../types.js";

// Per-channel tolerance, so antialiasing noise does not count as a change.
const CHANNEL_TOLERANCE = 16;

/**
 * Share of pixels that differ between two PNG screenshots, from 0 to 1.
 * The comparison runs in the browser's canvas, which avoids an image-decoding dependency.
 * Use a blank page: the images are passed in, nothing is loaded from the network.
 */
export async function pixelDiffRatio(page: Page, before: Buffer, after: Buffer): Promise<number> {
  return page.evaluate(
    async ([a, b, tolerance]) => {
      const decode = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        return createImageBitmap(new Blob([bytes], { type: "image/png" }));
      };
      const [first, second] = await Promise.all([decode(a), decode(b)]);
      const width = Math.max(first.width, second.width);
      const height = Math.max(first.height, second.height);

      const pixels = (image: ImageBitmap) => {
        const context = new OffscreenCanvas(width, height).getContext("2d");
        if (!context) throw new Error("2d canvas is not available");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, width, height).data;
      };
      const left = pixels(first);
      const right = pixels(second);

      // A size change leaves transparent padding on one side, which counts as different.
      let different = 0;
      for (let i = 0; i < left.length; i += 4) {
        for (let channel = 0; channel < 4; channel++) {
          if (Math.abs((left[i + channel] as number) - (right[i + channel] as number)) > tolerance) {
            different++;
            break;
          }
        }
      }
      return different / (width * height);
    },
    [before.toString("base64"), after.toString("base64"), CHANNEL_TOLERANCE] as const,
  );
}

export function visualGate(ratio: number, threshold: number, ruleId: string): GateResult {
  const percent = `${(ratio * 100).toFixed(2)}%`;
  if (ratio <= threshold) return { gate: "visual", passed: true, detail: `${percent} of pixels changed` };
  if (VISUAL_CHANGE_EXPECTED.has(ruleId)) {
    return {
      gate: "visual",
      passed: true,
      flagged: true,
      detail: `${percent} of pixels changed. A visible change is expected for ${ruleId}: compare the screenshots`,
    };
  }
  return {
    gate: "visual",
    passed: false,
    detail: `${percent} of pixels changed, above the ${(threshold * 100).toFixed(2)}% limit. The fix must not change how the page looks`,
  };
}
