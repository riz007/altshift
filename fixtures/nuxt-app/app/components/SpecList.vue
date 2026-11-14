<script setup lang="ts">
defineProps<{ specs: string[][] }>();
</script>

<template>
  <!-- altshift-seed: list rows are divs directly inside a ul -->
  <ul class="specs">
    <div v-for="[label, value] in specs" :key="label" class="specs__row">
      <span class="specs__label">{{ label }}</span>
      <span>{{ value }}</span>
    </div>
  </ul>
</template>

<style scoped>
.specs {
  margin: 1.5rem 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--line);
}

.specs__row {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--line);
}

.specs__label {
  color: var(--muted);
}
</style>
