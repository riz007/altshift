<script setup lang="ts">
const { count, open } = useCart();
</script>

<template>
  <div>
    <header class="site-header">
      <div class="container site-header__inner">
        <NuxtLink to="/" class="site-header__brand">Fieldnote Supply</NuxtLink>
        <nav aria-label="Main">
          <NuxtLink to="/">Shop</NuxtLink>
          <NuxtLink to="/shipping">Shipping</NuxtLink>
          <NuxtLink to="/checkout">Checkout</NuxtLink>
        </nav>
        <button type="button" class="button" @click="open = true">Cart ({{ count }})</button>
      </div>
    </header>

    <main class="container">
      <slot />
    </main>

    <footer class="site-footer">
      <div class="container">
        <p class="muted">Fieldnote Supply is a fixture shop. Nothing here is for sale.</p>
      </div>
    </footer>

    <CartDrawer />
  </div>
</template>

<style scoped>
.site-header {
  border-bottom: 1px solid var(--line);
}

.site-header__inner {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding-top: 0.75rem;
  padding-bottom: 0.75rem;
}

.site-header__brand {
  font-weight: 700;
  font-size: 1.2rem;
  text-decoration: none;
  padding: 0.5rem 0;
}

nav {
  display: flex;
  gap: 0.5rem;
  margin-right: auto;
}

nav a {
  padding: 0.5rem 0.75rem;
}

.site-footer {
  margin-top: 3rem;
  padding: 1.5rem 0;
  border-top: 1px solid var(--line);
  background: var(--surface);
}
</style>
