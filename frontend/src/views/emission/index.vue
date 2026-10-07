<template>
  <section class="page" data-module="emission">
    <header class="page-head">
      <div>
        <h2>环保指标监控管理</h2>
        <p class="page-desc">维护环保监控记录，围绕监控编号、监控指标、限值要求、实测值做登记、筛选与状态流转；发电量统计的填报结论会进入下方待复核清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记环保监控记录</button>
        <button class="btn" type="button" @click="exportRows">导出环保指标监控清单</button>
      </div>
    </header>

    <div v-if="loadError" class="retry-banner">
      <span>{{ loadError }}</span>
      <button class="btn" type="button" @click="reload">再试一次</button>
    </div>

    <template v-else>
      <div class="stat-row">
        <article v-for="item in stats" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">发电量统计待复核</span>
          <strong class="stat-value">{{ reviewRows.length }}</strong>
        </article>
      </div>

      <!-- 发电量统计的填报结论反映到这里：待复核清单 -->
      <section class="period-board">
        <h3 class="board-title">待复核清单（来自发电量统计）</h3>
        <ul class="review-list">
          <li v-for="row in reviewRows" :key="String(row.id)" class="review-item">
            <span class="period-name">{{ row['统计周期'] }}</span>
            <span>{{ row['监控编号'] }}</span>
            <span>吨垃圾发电量：{{ row['实测值'] }}</span>
            <span :class="['period-status', 'is-pending']">{{ row.status }}</span>
            <span class="row-actions">
              <button class="link" type="button" @click="review(row, '达标')">复核达标</button>
              <button class="link danger" type="button" @click="review(row, '异常')">复核异常</button>
            </span>
          </li>
          <li v-if="!reviewRows.length" class="period-empty">暂无待复核的发电量统计填报结论</li>
        </ul>
        <ul v-if="resolvedRows.length" class="review-list resolved">
          <li v-for="row in resolvedRows" :key="String(row.id)" class="review-item">
            <span class="period-name">{{ row['统计周期'] }}</span>
            <span>{{ row['监控编号'] }}</span>
            <span :class="['period-status', row.abnormal ? 'is-abnormal' : 'is-done']">{{ row.status }}</span>
            <span class="review-note">已完成复核，离开待复核清单</span>
          </li>
        </ul>
      </section>

      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <form class="filter-bar" @submit.prevent="reload">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无环保指标监控数据，可先登记环保监控记录</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ total }} 条环保指标监控记录</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  reconcileEmissionReviews,
  resolveEmissionReview,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('emission')
const columns = ['监控编号', '监控指标', '限值要求', '实测值', '达标判定', '监控日期', '监控人员', '监控状态']
const actions = ['提交监控', '判定达标', '标记未达标']
const statuses = ['待监控', '监控中', '已达标', '未达标']

const allData = ref<EntryRow[]>([])
const rows = computed(() =>
  allData.value.filter((row) => row.来源同步 !== true),
)
const reviewRows = computed(() => allData.value.filter((row) => row.来源同步 === true && row.待复核 === true))
const resolvedRows = computed(() =>
  allData.value.filter((row) => row.来源同步 === true && row.待复核 !== true),
)
const total = computed(() => rows.value.length)
const errorMessage = ref('')
const loadError = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = computed(() => [
  { label: '待监控指标', value: rows.value.filter((row) => String(row.status) === '待监控').length },
  { label: '已达标指标', value: rows.value.filter((row) => String(row.status) === '已达标').length },
  { label: '未达标指标', value: rows.value.filter((row) => String(row.status) === '未达标').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '环保监控记录登记入口尚未接入审批流'
}

function review(row: EntryRow, verdict: '达标' | '异常') {
  errorMessage.value = ''
  const result = resolveEmissionReview(Number(row.id), verdict)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  loadError.value = ''
  errorMessage.value = ''
  try {
    // 先和发电量统计对账，再渲染待复核清单，保证填报结论不丢、不重复。
    reconcileEmissionReviews()
    const payload = listEntries(meta.key, filters.value)
    allData.value = payload.items
  } catch (error) {
    allData.value = []
    loadError.value = error instanceof Error ? error.message : '取不到数：环保监控数据读取失败，请再试一次'
  }
}

onMounted(reload)
</script>
