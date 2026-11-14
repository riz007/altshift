export interface CartLine {
  slug: string;
  name: string;
  price: number;
  quantity: number;
}

export function useCart() {
  const lines = useState<CartLine[]>("cart-lines", () => []);
  const open = useState("cart-open", () => false);

  const count = computed(() => lines.value.reduce((sum, line) => sum + line.quantity, 0));
  const total = computed(() => lines.value.reduce((sum, line) => sum + line.price * line.quantity, 0));

  function add(product: { slug: string; name: string; price: number }) {
    const existing = lines.value.find((line) => line.slug === product.slug);
    if (existing) existing.quantity += 1;
    else lines.value.push({ slug: product.slug, name: product.name, price: product.price, quantity: 1 });
    open.value = true;
  }

  return { lines, open, count, total, add };
}
