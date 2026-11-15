<script setup lang="ts">
useHead({ title: "Checkout | Fieldnote Supply" });

const form = reactive({ email: "", name: "", address: "" });
const errors = reactive({ email: "", name: "", address: "" });
const giftWrap = ref(false);
const submitted = ref(false);

function submit() {
  errors.email = form.email.includes("@") ? "" : "Enter your email address.";
  errors.name = form.name.trim() ? "" : "Enter your full name.";
  errors.address = form.address.trim() ? "" : "Enter a delivery address.";
  submitted.value = !errors.email && !errors.name && !errors.address;
}
</script>

<template>
  <div class="checkout">
    <h1>Checkout</h1>

    <p v-if="submitted" role="status">Details saved. This fixture stops here: there is no payment step.</p>

    <form v-else novalidate @submit.prevent="submit">
      <div class="field">
        <label for="checkout-email">Email</label>
        <input id="checkout-email" v-model="form.email" type="email" autocomplete="email" :aria-invalid="!!errors.email" :aria-describedby="errors.email ? 'checkout-email-error' : undefined" />
        <!-- ariamend-seed: color-contrast error text colour is too light on white, on all three fields -->
        <p v-if="errors.email" id="checkout-email-error" class="field-error">{{ errors.email }}</p>
      </div>

      <div class="field">
        <label for="checkout-name">Full name</label>
        <input id="checkout-name" v-model="form.name" type="text" autocomplete="name" :aria-invalid="!!errors.name" :aria-describedby="errors.name ? 'checkout-name-error' : undefined" />
        <p v-if="errors.name" id="checkout-name-error" class="field-error">{{ errors.name }}</p>
      </div>

      <div class="field">
        <label for="checkout-address">Delivery address</label>
        <input id="checkout-address" v-model="form.address" type="text" autocomplete="street-address" :aria-invalid="!!errors.address" :aria-describedby="errors.address ? 'checkout-address-error' : undefined" />
        <p v-if="errors.address" id="checkout-address-error" class="field-error">{{ errors.address }}</p>
      </div>

      <!-- ariamend-seed: aria-required-attr custom checkbox never exposes aria-checked -->
      <div class="gift-wrap" role="checkbox" tabindex="0" :aria-checked="giftWrap" @click="giftWrap = !giftWrap" @keydown.space.prevent="giftWrap = !giftWrap">
        <span class="gift-wrap__box" :class="{ 'gift-wrap__box--on': giftWrap }" aria-hidden="true" />
        Add gift wrap (€3)
      </div>

      <button type="submit" class="button">Continue</button>
    </form>
  </div>
</template>

<style scoped>
.checkout {
  max-width: 32rem;
}

.field-error {
  margin: 0;
  color: var(--error);
}

.gift-wrap {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.75rem;
  margin-bottom: 1rem;
  cursor: pointer;
}

.gift-wrap__box {
  width: 1.25rem;
  height: 1.25rem;
  border: 2px solid var(--ink);
  border-radius: 0.2rem;
}

.gift-wrap__box--on {
  background: var(--brand);
}
</style>
