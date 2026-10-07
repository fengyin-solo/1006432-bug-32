<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>

    <div v-if="errorMessage" class="error-banner" role="alert">
      <span>{{ errorMessage }}</span>
      <button class="btn" type="button" @click="retryRefresh">再试一次</button>
    </div>

    <template v-else>
      <div class="stat-row">
        <article v-for="card in cards" :key="card.label" class="stat-card">
          <span class="stat-label">{{ card.label }}</span>
          <strong class="stat-value">{{ card.value }}</strong>
        </article>
      </div>
      <div class="stat-row">
        <article class="stat-card stat-card-accent">
          <span class="stat-label">发电量统计周期</span>
          <strong class="stat-value">{{ periodCount }}</strong>
        </article>
      </div>
      <table class="data-table">
        <thead>
          <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in moduleRows" :key="row.name">
            <td>{{ row.name }}</td>
            <td>{{ row.created }}</td>
            <td>{{ row.pending }}</td>
            <td>{{ row.abnormal }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import {
  loadOverview,
  READ_ERROR_MESSAGE,
  recoverRows,
} from '@/api/local-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const periodCount = ref(0)
const errorMessage = ref('')

function refresh() {
  errorMessage.value = ''
  try {
    const payload = loadOverview()
    cards.value = payload.cards
    moduleRows.value = payload.modules
    periodCount.value = payload.periodCount
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : READ_ERROR_MESSAGE
  }
}

function retryRefresh() {
  try {
    refresh()
    if (errorMessage.value) {
      throw new Error(errorMessage.value)
    }
  } catch {
    // 再试一次仍取不到数时回到示例数据，保证概览周期数与列表对得上
    recoverRows()
    errorMessage.value = ''
    const payload = loadOverview()
    cards.value = payload.cards
    moduleRows.value = payload.modules
    periodCount.value = payload.periodCount
  }
}

onMounted(refresh)
</script>
