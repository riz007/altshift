<script setup lang="ts">
defineProps<{ product: { slug: string; name: string; price: number; image: string } }>();

const saved = ref(false);
</script>

<template>
  <article class="product-card">
    <NuxtLink :to="`/products/${product.slug}`">
      <img :src="product.image" :alt="product.name" width="400" height="300" />
    </NuxtLink>
    <div class="product-card__body">
      <h3 class="product-card__name">
        <NuxtLink :to="`/products/${product.slug}`">{{ product.name }}</NuxtLink>
      </h3>
      <p class="product-card__price">€{{ product.price }}</p>
      <!-- ariamend-seed: button-name icon-only wishlist toggle, repeated on every card -->
      <button type="button" class="icon-button product-card__wishlist" :aria-pressed="saved" @click="saved = !saved">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" :fill="saved ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2">
          <path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" />
        </svg>
      </button>
    </div>
  </article>
</template>

<style scoped>
.product-card {
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  overflow: hidden;
}

.product-card__body {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.25rem 0.75rem;
  padding: 0.75rem;
}

.product-card__name {
  margin: 0;
  font-size: 1rem;
}

.product-card__name a {
  display: inline-block;
  padding: 0.25rem 0;
}

.product-card__price {
  margin: 0;
  grid-column: 1;
}

.product-card__wishlist {
  grid-column: 2;
  grid-row: 1 / span 2;
}
</style>
