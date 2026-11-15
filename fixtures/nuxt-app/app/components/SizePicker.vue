<script setup lang="ts">
const size = defineModel<string>({ default: "one" });
</script>

<template>
  <div class="field">
    <span class="size-picker__label">Size</span>
    <!-- ariamend-seed: select-name the visible "Size" text is not associated with the select -->
    <select v-model="size" class="size-picker__select">
      <option value="one">One size</option>
      <option value="gift">Gift boxed</option>
    </select>
  </div>
</template>

<style scoped>
.size-picker__label {
  font-weight: 600;
}

.size-picker__select {
  max-width: 14rem;
}
</style>
