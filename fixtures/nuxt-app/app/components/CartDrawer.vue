<script setup lang="ts">
const { lines, open, total } = useCart();
</script>

<template>
  <div v-if="open" class="cart-backdrop" @click.self="open = false">
    <div class="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-drawer-title">
      <div class="cart-drawer__header">
        <h2 id="cart-drawer-title" class="cart-drawer__title">Your cart</h2>
        <!-- altshift-seed: button-name icon-only close button -->
        <button type="button" class="icon-button cart-drawer__close" @click="open = false">
          <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <p v-if="lines.length === 0">Your cart is empty.</p>
      <ul v-else class="cart-drawer__lines">
        <li v-for="line in lines" :key="line.slug">
          <span>{{ line.quantity }} × {{ line.name }}</span>
          <span>€{{ line.price * line.quantity }}</span>
        </li>
      </ul>

      <p class="cart-drawer__total">Total: €{{ total }}</p>
      <NuxtLink to="/checkout" class="button" @click="open = false">Checkout</NuxtLink>
    </div>
  </div>
</template>

<style scoped>
.cart-backdrop {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 0.4);
}

.cart-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(24rem, 100%);
  padding: 1.25rem;
  background: #fff;
  overflow-y: auto;
}

.cart-drawer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cart-drawer__title {
  margin: 0;
}

.cart-drawer__lines {
  padding: 0;
  list-style: none;
}

.cart-drawer__lines li {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--line);
}

.cart-drawer__total {
  font-weight: 600;
}
</style>
