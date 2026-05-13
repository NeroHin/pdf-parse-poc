<template>
  <div v-if="warnings.length > 0" class="parser-warnings">
    <el-alert
      v-for="(warning, idx) in warnings"
      :key="idx"
      :title="warning"
      type="warning"
      :closable="false"
      show-icon
      class="warning-item"
    />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  warnings: string[];
}>();
</script>

<style scoped>
.parser-warnings {
  padding: 8px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.warning-item {
  font-size: 12px;
}
</style>
