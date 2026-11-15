<template>
  <section class="promo" aria-labelledby="promo-title">
    <div>
      <h2 id="promo-title">The autumn field kit</h2>
      <p>A day pack, a mug and a notebook. Everything for a long walk.</p>
    </div>
    <!-- ariamend-seed: link-name arrow-only link to the featured product -->
    <NuxtLink to="/products/canvas-pack" class="icon-button promo__link">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </NuxtLink>
  </section>
</template>

<style scoped>
.promo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 1.5rem 0;
  padding: 1.5rem;
  border-radius: 0.5rem;
  background: var(--surface);
}

.promo h2 {
  margin: 0 0 0.25rem;
}

.promo p {
  margin: 0;
}

.promo__link {
  flex: none;
}
</style>
