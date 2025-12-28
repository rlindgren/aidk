<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  levels: {
    type: Array,
    required: true
  }
})

const activeLevel = ref(0)
const activeTab = ref('agent')

const currentLevel = computed(() => props.levels[activeLevel.value])
const currentCode = computed(() => currentLevel.value.code[activeTab.value])

const tabs = ['agent', 'usage', 'output']
</script>

<template>
  <div class="progressive-example">
    <!-- Level selector -->
    <div class="level-selector">
      <button
        v-for="(level, index) in levels"
        :key="index"
        :class="['level-button', { active: activeLevel === index }]"
        @click="activeLevel = index"
      >
        <div class="level-number">{{ index + 1 }}</div>
        <div class="level-name">{{ level.name }}</div>
      </button>
    </div>

    <!-- Level description -->
    <div class="level-description">
      <h3>{{ currentLevel.title }}</h3>
      <p>{{ currentLevel.description }}</p>
      <div class="level-features">
        <span v-for="feature in currentLevel.features" :key="feature" class="feature-tag">
          {{ feature }}
        </span>
      </div>
    </div>

    <!-- Code tabs -->
    <div class="code-container">
      <div class="code-tabs">
        <button
          v-for="tab in tabs"
          :key="tab"
          :class="['code-tab', { active: activeTab === tab }]"
          @click="activeTab = tab"
        >
          {{ tab }}
        </button>
      </div>
      <div class="code-content">
        <pre><code v-html="currentCode"></code></pre>
      </div>
    </div>

    <!-- Navigation -->
    <div class="level-nav">
      <button
        :disabled="activeLevel === 0"
        @click="activeLevel--"
        class="nav-button"
      >
        ← Previous
      </button>
      <span class="level-indicator">
        Level {{ activeLevel + 1 }} of {{ levels.length }}
      </span>
      <button
        :disabled="activeLevel === levels.length - 1"
        @click="activeLevel++"
        class="nav-button"
      >
        Next →
      </button>
    </div>
  </div>
</template>

<style scoped>
.progressive-example {
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  overflow: hidden;
  margin: 2rem 0;
}

.level-selector {
  display: flex;
  gap: 0.5rem;
  padding: 1rem;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  overflow-x: auto;
}

.level-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.75rem 1rem;
  border: 2px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 80px;
}

.level-button:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}

.level-button.active {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.level-number {
  font-size: 1.5rem;
  font-weight: bold;
  color: var(--vp-c-brand-1);
}

.level-name {
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
}

.level-description {
  padding: 1.5rem;
  border-bottom: 1px solid var(--vp-c-divider);
}

.level-description h3 {
  margin: 0 0 0.5rem 0;
  color: var(--vp-c-brand-1);
}

.level-description p {
  margin: 0 0 1rem 0;
  color: var(--vp-c-text-2);
}

.level-features {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.feature-tag {
  padding: 0.25rem 0.75rem;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border-radius: 4px;
  font-size: 0.875rem;
}

.code-container {
  background: var(--vp-code-block-bg);
}

.code-tabs {
  display: flex;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}

.code-tab {
  padding: 0.75rem 1.5rem;
  border: none;
  background: none;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.2s;
  text-transform: capitalize;
}

.code-tab:hover {
  color: var(--vp-c-text-1);
}

.code-tab.active {
  color: var(--vp-c-brand-1);
  border-bottom: 2px solid var(--vp-c-brand-1);
}

.code-content {
  padding: 1.5rem;
  overflow-x: auto;
}

.code-content pre {
  margin: 0;
  background: none;
}

.level-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background: var(--vp-c-bg-soft);
  border-top: 1px solid var(--vp-c-divider);
}

.nav-button {
  padding: 0.5rem 1rem;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.nav-button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.nav-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.level-indicator {
  color: var(--vp-c-text-2);
  font-size: 0.875rem;
}

@media (max-width: 768px) {
  .level-selector {
    flex-wrap: wrap;
  }
  
  .level-button {
    flex: 1;
    min-width: 60px;
  }
}
</style>











