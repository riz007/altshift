import { defineJourney } from "ariamend";

export default defineJourney({
  name: "cart-open",
  run: async ({ page, check }) => {
    await page.goto("/products/trail-mug");
    // Clicks before hydration are lost, so wait for the dev bundle to finish loading.
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Add to cart" }).click();
    await page.getByRole("dialog").waitFor();
    // The product page behind the drawer is already covered by its own page target.
    await check("drawer", { include: [".cart-drawer"] });
  },
});
