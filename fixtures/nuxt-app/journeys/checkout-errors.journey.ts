import { defineJourney } from "ariamend";

// Stops at validation errors. The fixture has no payment step and never places an order.
export default defineJourney({
  name: "checkout-errors",
  run: async ({ page, check }) => {
    await page.goto("/checkout");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.locator(".field-error").first().waitFor();
    await check("errors");
  },
});
