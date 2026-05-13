<template>
  <el-config-provider :locale="zhTw">
    <PdfParsePocPage />
  </el-config-provider>
</template>

<script setup lang="ts">
import { ElConfigProvider } from "element-plus";
import zhTw from "element-plus/es/locale/lang/zh-tw";
import PdfParsePocPage from "./pages/PdfParsePocPage.vue";
</script>
