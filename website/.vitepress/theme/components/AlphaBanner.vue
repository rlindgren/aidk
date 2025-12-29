<script setup></script>

<template>
  <div class="alpha-banner-wrapper">
    <div class="alpha-banner">
      <span class="alpha-badge">ALPHA</span>
      <span
        >v0.1.x — APIs may change.
        <a href="/aidk/docs/getting-started">Get started anyway</a></span
      >
    </div>
  </div>
</template>

<style scoped>
.alpha-banner-wrapper {
  width: 100%;
  display: flex;
  justify-content: center;
  padding: 0;
  margin-top: 24px;
}

.alpha-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 0.75rem;
  padding: 0.6rem 1.25rem;
  background: linear-gradient(
    135deg,
    var(--vp-c-brand-soft) 0%,
    var(--vp-c-warning-soft) 100%
  );
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 8px;
  font-size: 0.9rem;
}

.alpha-badge {
  background: var(--vp-c-brand-1);
  color: white;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-weight: 700;
  font-size: 0.7rem;
  letter-spacing: 0.05em;
}

.alpha-banner a {
  color: var(--vp-c-brand-1);
  font-weight: 500;
}

@media (max-width: 480px) {
  .alpha-banner {
    flex-direction: column;
    text-align: center;
    gap: 0.5rem;
  }
}
</style>
