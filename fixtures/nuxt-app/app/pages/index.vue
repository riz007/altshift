<script setup lang="ts">
import products from "~/data/products.json";

useHead({ title: "Fieldnote Supply" });
</script>

<template>
  <div>
    <h1>Gear for long walks</h1>
    <PromoBanner />

    <h2>Shop</h2>
    <div class="product-grid">
      <ProductCard v-for="product in products" :key="product.slug" :product="product" />
    </div>

    <NewsletterForm />
  </div>
</template>

<style scoped>
.product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
  gap: 1rem;
}
</style>
