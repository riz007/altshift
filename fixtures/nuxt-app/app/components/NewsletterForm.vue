<script setup lang="ts">
const email = ref("");
const done = ref(false);
</script>

<template>
  <section class="newsletter" aria-labelledby="newsletter-title">
    <h2 id="newsletter-title">Trail notes, once a month</h2>
    <p v-if="done" role="status">Thanks. Check your inbox to confirm.</p>
    <form v-else class="newsletter__form" @submit.prevent="done = true">
      <!-- ariamend-seed: label email input with no label, placeholder or aria-label -->
      <label for="newsletter-email">Email</label>
      <input id="newsletter-email" v-model="email" class="newsletter__input" type="email" name="email" autocomplete="email" required />
      <button type="submit" class="button">Subscribe</button>
    </form>
  </section>
</template>

<style scoped>
.newsletter {
  margin-top: 2.5rem;
}

.newsletter__form {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.newsletter__input {
  flex: 1 1 16rem;
  min-height: 2.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid #7b8794;
  border-radius: 0.4rem;
  font: inherit;
}
</style>
