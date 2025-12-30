<script setup></script>

<template>
  <div class="VPHomeHero alpha-banner-wrapper">
    <div class="container">
      <div class="alpha-banner">
        <div>
          <span class="alpha-badge">ALPHA</span>
          <span>v0.1.x — APIs may change.</span>
        </div>

        <a href="/aidk/docs/getting-started">Get started anyway</a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.alpha-banner-wrapper {
  width: 100%;
  display: flex;
  justify-content: center;
  padding: 0 24px;
  margin-bottom: 24px;
}

.alpha-banner-wrapper .container {
  display: flex;
  margin: 0 auto;
  max-width: 1152px;
  flex: 1;
}

.alpha-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-direction: column;
  flex: 1;
  gap: 0;
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

.alpha-banner div {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.75rem;
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
    gap: 0;
  }
}

@media (min-width: 640px) {
  .alpha-banner-wrapper{
    padding: 0 48px;
  }
  .alpha-banner {
    flex-direction: row;
    gap: 0.75rem;
  }
}

@media (min-width: 960px) {
  .alpha-banner-wrapper {
    padding: 0 64px;
  }
}
</style>
