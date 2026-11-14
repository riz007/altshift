import { describe, expect, it } from "vitest";
import { normalizeSelector } from "./normalize.js";

describe("normalizeSelector", () => {
  it.each([
    // Stable selectors pass through untouched.
    [".cart-drawer > button:nth-child(2)", ".cart-drawer > button:nth-child(2)"],
    ["#checkout-email", "#checkout-email"],
    ["#step-2", "#step-2"],
    [".card__title", ".card__title"],
    ['a[href$="/sale.html#top"]', 'a[href$="/sale.html#top"]'],
    ['img[src="/img/a.b_c__x9Y8z.png"]', 'img[src="/img/a.b_c__x9Y8z.png"]'],

    // Framework scope attributes.
    [".close[data-v-7ba5bd90]", ".close"],
    ['.close[data-v-7ba5bd90=""] > svg', ".close > svg"],
    ["nav[data-astro-cid-j7pv25f6] > a", "nav > a"],

    // Generated class names.
    [".Button_root__a1B2c", ".Button_root"],
    ["._title_1x2y3_7 > span", "._title > span"],
    [".css-1q2w3e4", ".css-*"],
    [".sc-bdnxRM", ".sc-*"],
    ["button.svelte-1abc23", "button.svelte-*"],

    // Dynamic IDs.
    ["#radix-\\:r1\\:", "#radix-*"],
    ["#\\:r1\\:-form-item", "#*-form-item"],
    ["#headlessui-menu-button-_r_3_", "#headlessui-menu-button-*"],
    ["#v-0-12", "#v-*"],
    ["#input-48213", "#input-*"],
    ["#modal_9f8e7d6c5b", "#modal-*"],
    ["#a3bb189e-8bf9-3888-9912-ace4e6543002", "#*"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeSelector(input)).toBe(expected);
  });

  it("gives two renders of the same element the same result", () => {
    expect(normalizeSelector("#headlessui-dialog-\\:r5\\: > .css-9x8y7z")).toBe(
      normalizeSelector("#headlessui-dialog-\\:rb\\: > .css-1a2b3c"),
    );
  });
});
