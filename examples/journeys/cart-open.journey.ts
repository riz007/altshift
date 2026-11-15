// Journeys reach states a plain page load cannot. Stop before placing an order,
// and use test products and test payment details only.
import { defineJourney } from "ariamend";

export default defineJourney({
  name: "cart-open",
  run: async ({ page, check }) => {
    await page.goto("/products/test-shirt");
    await page.getByRole("button", { name: "Add to cart" }).click();
    await page.getByRole("dialog").waitFor();
    await check("drawer");
  },
});
