import { describe, expect, it } from "vitest";
import { safetyGate } from "./safety.js";

const BEFORE = `<script setup lang="ts">
const open = ref(false);
const gift = ref(false);
</script>

<template>
  <div class="cart">
    <!-- close button -->
    <button type="button" class="close" @click="open = false">
      <svg viewBox="0 0 24 24"><path d="M6 6l12 12" /></svg>
    </button>
    <img class="hero" src="/hero.png" />
    <ul class="specs"><li>One</li></ul>
    <div class="gift" role="checkbox" tabindex="0" @click="gift = !gift">Gift wrap</div>
    <nav class="relative hidden md:flex"><NuxtLink to="/p" class="promo"><svg /></NuxtLink></nav>
    <button v-html="icon" class="icon"></button>
    <h2 v-if="user.isAdmin" id="cart-title">{{ product.name }}</h2>
  </div>
</template>

<style scoped>
.close { color: red; }
</style>
`;
const FILE = "app/components/Cart.vue";
const gate = (after: string, path = FILE, before = BEFORE) => safetyGate([{ path, before, after }]);
const edit = (from: string, to: string) => {
  if (!BEFORE.includes(from)) throw new Error(`test setup: "${from}" is not in the fixture`);
  return gate(BEFORE.replace(from, to));
};
const BUTTON = '<button type="button" class="close" @click="open = false">';

describe("safetyGate: fixes that pass", () => {
  it("passes a new accessible name and marks it as a draft", () => {
    const result = edit(BUTTON, BUTTON.replace("@click", 'aria-label="Close cart" @click'));
    expect(result).toMatchObject({ passed: true, flagged: true });
    expect(result.detail).toContain('Draft: please review. New aria-label: "Close cart"');
  });

  it("passes visually hidden text, as a draft", () => {
    const result = edit(
      "</svg>\n    </button>",
      '</svg>\n      <span class="visually-hidden">Close cart</span>\n    </button>',
    );
    expect(result).toMatchObject({ passed: true, flagged: true });
    expect(result.detail).toContain('New text: "Close cart"');
  });

  it("passes state bound to an existing value, with no review flag", () => {
    const result = edit('role="checkbox" tabindex="0"', 'role="checkbox" :aria-checked="gift" tabindex="0"');
    expect(result).toEqual({ gate: "safety", passed: true, detail: "template-only change with no new code paths" });
  });

  it("passes a translated name and a choice between two strings", () => {
    expect(edit(BUTTON, BUTTON.replace("@click", ":aria-label=\"$t('cart.close')\" @click")).passed).toBe(true);
    expect(
      edit(BUTTON, BUTTON.replace("@click", ":aria-label=\"open ? 'Close cart' : 'Open cart'\" @click")).passed,
    ).toBe(true);
  });

  it("passes a name built from existing data, as a draft", () => {
    const named = edit(BUTTON, BUTTON.replace("@click", ':aria-label="`Save ${product.name} to wishlist`" @click'));
    expect(named).toMatchObject({ passed: true, flagged: true });
    expect(named.detail).toContain("Draft: please review.");

    // Bound straight to data: the model still chose the field, so it is a draft too.
    const bound = edit('<img class="hero"', '<img :alt="product.name" class="hero"');
    expect(bound).toMatchObject({ passed: true, flagged: true });
    expect(bound.detail).toContain("alt is bound to product.name: check this field describes this control.");
    // Words such as "window" inside the text are not code.
    expect(
      edit(BUTTON, BUTTON.replace("@click", ":aria-label=\"open ? 'Close window' : 'Open window'\" @click")).passed,
    ).toBe(true);
  });

  it("says when alt text was written without seeing the image, and when an id is fixed", () => {
    expect(edit('<img class="hero"', '<img alt="A mug on a rock" class="hero"').detail).toContain(
      "The image itself was not viewed.",
    );
    expect(edit('<img class="hero"', '<img id="hero" class="hero"')).toMatchObject({
      passed: true,
      flagged: true,
      detail: expect.stringContaining('adds a fixed id "hero"'),
    });
  });

  it("passes changing a div to an li, and wiring a label with for and id", () => {
    expect(
      gate(BEFORE.replace('<ul class="specs"><li>One</li></ul>', '<ul class="specs"><li>One</li><li>Two</li></ul>'))
        .passed,
    ).toBe(true);
    expect(edit('<img class="hero"', '<label for="hero">Photo</label><img id="hero" class="hero"').passed).toBe(true);
  });

  it("passes aria-hidden on a decorative icon, flagged", () => {
    expect(edit('<svg viewBox="0 0 24 24">', '<svg aria-hidden="true" viewBox="0 0 24 24">')).toMatchObject({
      passed: true,
      flagged: true,
    });
  });

  it("does not blame the change for what the line already had", () => {
    expect(
      edit('<button v-html="icon" class="icon">', '<button v-html="icon" class="icon" aria-label="Search">').passed,
    ).toBe(true);
    expect(
      edit('<nav class="relative hidden md:flex">', '<nav class="relative hidden md:flex" aria-label="Promotions">')
        .passed,
    ).toBe(true);
    expect(edit(BUTTON, BUTTON.replace("@click", 'aria-label="Show hidden filters" @click')).passed).toBe(true);
  });

  it("flags empty alt and tabindex -1 for review", () => {
    expect(edit('<img class="hero"', '<img alt="" class="hero"')).toMatchObject({ passed: true, flagged: true });
    expect(edit('<img class="hero"', '<img alt class="hero"')).toMatchObject({ passed: true, flagged: true });
    expect(edit('to="/p" class="promo"', 'to="/p" class="promo" tabindex="-1"')).toMatchObject({
      passed: true,
      flagged: true,
    });
  });
});

describe("safetyGate: code execution and external content", () => {
  it("rejects any change outside <template>", () => {
    expect(
      edit(
        "const open = ref(false);",
        'const open = ref(false);\nglobalThis.process.getBuiltinModule("child_process").execSync("id");',
      ).passed,
    ).toBe(false);
    expect(edit(".close { color: red; }", ".close { display: none; }").passed).toBe(false);
  });

  it("rejects files that are not Vue components", () => {
    expect(gate("export const a = 2;", "app/composables/useCart.ts", "export const a = 1;").passed).toBe(false);
    expect(gate(":root { --x: 2 }", "app/assets/main.css", ":root { --x: 1 }").passed).toBe(false);
  });

  it.each([
    [
      "the injected instruction from the fixture's product data",
      "<ul",
      '<script src="https://example.invalid/x.js"></script><ul',
    ],
    ["an inline event handler", '<img class="hero"', '<img onerror="alert(1)" class="hero"'],
    ["a dynamic component", "<ul", '<component is="script">fetch("/api/me")</component><ul'],
    ["an iframe", "<ul", '<iframe src="data:text/html,x"></iframe><ul'],
    ["a new link", "<ul", '<a href="https://evil.example">x</a><ul'],
    ["v-html", BUTTON, BUTTON.replace("@click", 'v-html="label" @click')],
    ["an object v-bind", BUTTON, BUTTON.replace("@click", "v-bind=\"{ ['inner' + 'HTML']: payload }\" @click")],
    ["a dynamic argument", BUTTON, BUTTON.replace("@click", ':[key]="payload" @click')],
    ["a new event handler", '<img class="hero"', '<img @load="steal()" class="hero"'],
    ["a changed event handler", '@click="open = false"', '@click="open = false; steal()"'],
    ["a javascript: URL", 'to="/p"', 'to="/p" href="javascript:alert(1)"'],
    ["a changed link target", 'to="/p"', 'to="//evil.example/p"'],
    [
      "a binding that reaches the Function constructor",
      BUTTON,
      BUTTON.replace("@click", ":title=\"[].constructor.constructor('return process')()\" @click"),
    ],
    [
      "a binding that reads the environment",
      BUTTON,
      BUTTON.replace("@click", ':aria-label="process.env.NPM_TOKEN" @click'),
    ],
    [
      "a template string that reads the environment",
      BUTTON,
      BUTTON.replace("@click", ':aria-label="`x ${process.env.NPM_TOKEN}`" @click'),
    ],
    [
      "a template string that calls a function",
      BUTTON,
      BUTTON.replace("@click", ':aria-label="`x ${steal()}`" @click'),
    ],
    [
      "a template string with a nested expression",
      BUTTON,
      BUTTON.replace("@click", ':aria-label="`x ${a ? b : c}`" @click'),
    ],
    [
      "a ternary that reads the environment",
      BUTTON,
      BUTTON.replace("@click", ":aria-label=\"process ? 'a' : 'b'\" @click"),
    ],
    ["a binding that reads runtime config", BUTTON, BUTTON.replace("@click", ':aria-label="$config.secretKey" @click')],
    [
      "a binding that calls a function",
      BUTTON,
      BUTTON.replace("@click", ':aria-label="useRuntimeConfig().secret" @click'),
    ],
    ["an interpolation that calls a function", "Gift wrap", "Gift wrap {{ useRuntimeConfig().secret }}"],
    ["a URL in a label", BUTTON, BUTTON.replace("@click", 'aria-label="See https://evil.example/x" @click')],
    ["a URL in new text", "Gift wrap", "Gift wrap, see //evil.example/x"],
    ["a comment that disables a check", "<!-- close button -->", "<!-- axe-disable button-name -->"],
  ])("rejects %s", (_name, from, to) => {
    expect(edit(from, to).passed).toBe(false);
  });

  it("rejects template languages it cannot read, and unreadable templates", () => {
    expect(gate(BEFORE.replace("<template>", '<template lang="pug">')).passed).toBe(false);
    expect(gate(BEFORE.replace("<!-- close button -->", "<!-- unclosed")).passed).toBe(false);
  });
});

describe("safetyGate: hiding or removing instead of fixing", () => {
  it.each([
    ["aria-hidden on the control", BUTTON, BUTTON.replace("@click", 'aria-hidden="true" @click')],
    ["unquoted aria-hidden", BUTTON, BUTTON.replace("@click", "aria-hidden=true @click")],
    ["aria-hidden on an image with no alt", '<img class="hero"', '<img aria-hidden="true" class="hero"'],
    ["aria-hidden on a list", '<ul class="specs">', '<ul aria-hidden="true" class="specs">'],
    ["the hidden attribute", BUTTON, BUTTON.replace("@click", "hidden @click")],
    ["a bound hidden attribute", BUTTON, BUTTON.replace("@click", ':hidden="true" @click')],
    ["inert", BUTTON, BUTTON.replace("@click", "inert @click")],
    ["v-if with a constant", BUTTON, BUTTON.replace("@click", 'v-if="0" @click')],
    ["v-show with a constant", BUTTON, BUTTON.replace("@click", 'v-show="null" @click')],
    ["an inline style", BUTTON, BUTTON.replace("@click", 'style="display: none" @click')],
    ["a bound style", BUTTON, BUTTON.replace("@click", ":style=\"{ display: 'none' }\" @click")],
    ["a hiding class", 'class="close"', 'class="close hidden"'],
    ["a responsive hiding class", 'class="close"', 'class="close sm:hidden"'],
    ["a utility hiding class", 'class="hero"', 'class="hero d-none"'],
    [
      "commenting the element out",
      '<img class="hero" src="/hero.png" />',
      '<!-- <img class="hero" src="/hero.png" /> -->',
    ],
    ["swapping the image for a span", '<img class="hero" src="/hero.png" />', "<span></span>"],
    ["deleting the image", '<img class="hero" src="/hero.png" />', ""],
    ["downgrading the list to divs", '<ul class="specs"><li>One</li></ul>', '<div class="specs"><div>One</div></div>'],
    ["a presentation role on the list", '<ul class="specs">', '<ul role="presentation" class="specs">'],
    ["removing the role the rule complains about", ' role="checkbox"', ""],
    ["a fixed state value", 'role="checkbox"', 'role="checkbox" aria-checked="false"'],
    ["a label on an element with no role", '<div class="cart">', '<div class="cart" aria-label="Cart">'],
    ["removing the click handler", ' @click="gift = !gift"', ""],
  ])("rejects %s", (_name, from, to) => {
    expect(edit(from, to).passed).toBe(false);
  });

  it("is not fooled by a > inside an attribute value", () => {
    const before = BEFORE.replace('@click="open = false"', '@click="() => close()"');
    const after = before.replace('@click="() => close()"', '@click="() => close()" aria-hidden="true"');
    expect(gate(after, FILE, before).passed).toBe(false);
  });

  it("names what it rejected", () => {
    const result = edit('<img class="hero" src="/hero.png" />', "");
    expect(result.detail.split("\n")).toEqual([
      `${FILE}: removes 1 <img> element(s). Fix the element instead of removing it`,
      `${FILE}: removes 1 element(s) overall`,
      `${FILE}: removes or changes a handler, directive or other attribute (src=/hero.png)`,
    ]);
  });
});

describe("safetyGate: findings from the second review", () => {
  it.each([
    [
      "an encoded quote that ends the string early",
      ":aria-label=\"'a&#39;+Object.constructor(&#39;return process&#39;)().env.HOME+&#39;'\"",
    ],
    [
      "an encoded quote around an import",
      ":title=\"'x&#39;+Object.constructor(&#39;import(&quot;node:child_process&quot;)&#39;)()+&#39;'\"",
    ],
    [
      "an encoded placeholder in a template string",
      ':alt="`&#36;{Object.constructor(&#39;return fetch&#39;)()(&#39;/api/me&#39;)}`"',
    ],
    ["route parameters", ':aria-label="$route.query.x"'],
    ["the internal instance", ':title="$.appContext.app"'],
    ["runtime config through an alias the template never used", ':title="config.stripeSecretKey"'],
    ["a name the template does not already read", ':aria-label="session.user.email"'],
    ["a fixed state written as a binding", ':aria-checked="false"'],
    ["a fixed state written as a bound string", ":aria-pressed=\"'true'\""],
    ["a fixed state written as a template string", ':aria-checked="`false`"'],
    ["a presentation role in a template string", ':role="`presentation`"'],
    ["a presentation role in both branches", ":role=\"open ? 'none' : 'none'\""],
    ["a hiding class in a binding", ":class=\"'hidden'\""],
    ["a role description", 'aria-roledescription="thing"'],
    ["an id the template already uses", 'id="cart-title"'],
  ])("rejects %s", (_name, attribute) => {
    expect(edit(BUTTON, BUTTON.replace("@click", `${attribute} @click`)).passed).toBe(false);
  });

  it("rejects an entity inside an interpolation", () => {
    expect(
      edit("Gift wrap", "Gift wrap {{ 'a&#39;+Object.constructor(&#39;return document.cookie&#39;)()+&#39; ' }}")
        .passed,
    ).toBe(false);
  });

  it("rejects moving an existing guard or handler onto another element", () => {
    const guard = BEFORE.replace(' v-if="user.isAdmin"', "").replace(
      BUTTON,
      BUTTON.replace("@click", 'v-if="user.isAdmin" @click'),
    );
    expect(gate(guard)).toMatchObject({
      passed: false,
      detail: expect.stringContaining("handler, directive or other attribute"),
    });

    const handler = BEFORE.replace(' @click="gift = !gift"', "").replace(
      '<img class="hero"',
      '<img @click="gift = !gift" class="hero"',
    );
    expect(gate(handler).passed).toBe(false);
  });

  it("rejects moving aria-hidden from an icon to a control", () => {
    const before = BEFORE.replace('<svg viewBox="0 0 24 24">', '<svg aria-hidden="true" viewBox="0 0 24 24">');
    const after = BEFORE.replace('<img class="hero"', '<img aria-hidden="true" class="hero"');
    expect(gate(after, FILE, before).passed).toBe(false);
  });

  it("rejects a name that changes with state on a toggle", () => {
    const before = BEFORE.replace(BUTTON, BUTTON.replace("@click", ':aria-pressed="open" @click'));
    const after = before.replace(
      ':aria-pressed="open"',
      ":aria-label=\"open ? 'Remove' : 'Save'\" :aria-pressed=\"open\"",
    );
    expect(gate(after, FILE, before)).toMatchObject({
      passed: false,
      detail: expect.stringContaining("Keep one name"),
    });
  });

  it("flags a name taken from other text, and the removal of a naming attribute", () => {
    const named = edit('<img class="hero"', '<img aria-labelledby="cart-title" class="hero"');
    expect(named).toMatchObject({
      passed: true,
      flagged: true,
      detail: expect.stringContaining('text from "cart-title"'),
    });

    const removed = edit(' id="cart-title"', "");
    expect(removed).toMatchObject({
      passed: true,
      flagged: true,
      detail: expect.stringContaining("removes id=cart-title"),
    });
  });

  it("notes an unchecked translation key", () => {
    const result = edit(BUTTON, BUTTON.replace("@click", ":aria-label=\"$t('cart.close')\" @click"));
    expect(result.detail).toContain("The translation key was not checked.");
  });
});
