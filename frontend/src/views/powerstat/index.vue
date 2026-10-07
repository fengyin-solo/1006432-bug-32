<template>
  <section class="page" data-module="powerstat">
    <header class="page-head">
      <div>
        <h2>发电量统计管理</h2>
        <p class="page-desc">维护发电量统计记录，围绕统计编号、统计周期、发电量、上网电量做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记发电量统计记录</button>
        <button class="btn" type="button" @click="exportRows">导出发电量统计清单</button>
        <button class="btn ghost" type="button" @click="simulateReadFailure">模拟读取失败</button>
      </div>
    </header>

    <div v-if="loadError" class="error-banner" role="alert">
      <span>{{ loadError }}</span>
      <button class="btn" type="button" @click="retryLoad">再试一次</button>
    </div>

    <div v-else class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p v-if="!loadError" class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form v-if="!loadError" class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table v-if="!loadError" class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ cellText(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看详情</button>
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
          <td :colspan="columns.length + 2" class="empty-state">
            {{ hasActiveFilter ? `按「${activeFilterText}」查不到发电量统计记录，请核对统计编号后重试` : '本统计周期暂无统计，可先登记发电量统计记录' }}
          </td>
        </tr>
      </tbody>
    </table>

    <section v-if="!loadError" class="detail-panel">
      <h3>发电量统计详情</h3>
      <form class="detail-query" @submit.prevent="queryDetail">
        <label class="filter-item">
          <span>按统计编号查询</span>
          <input v-model="detailKeyword" placeholder="输入统计编号，如 POWE-0003" />
        </label>
        <button class="btn" type="submit">查询详情</button>
      </form>
      <div v-if="detailState === 'error'" class="error-banner">
        <span>详情数据取不到数，请重试一次</span>
        <button class="btn" type="button" @click="retryDetail">再试一次</button>
      </div>
      <div v-else-if="detailState === 'empty'" class="empty-state">
        按统计编号「{{ detailKeyword }}」查不到发电量统计记录，请核对编号后重试
      </div>
      <table v-else-if="detailState === 'ready' && detailRow" class="data-table">
        <tbody>
          <tr v-for="field in detailFields" :key="field">
            <th>{{ field }}</th>
            <td>{{ cellText(detailRow, field) }}</td>
          </tr>
          <tr>
            <th>当前状态</th>
            <td>{{ detailRow.status }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="page-desc">输入统计编号可查看该周期的填报详情。</p>
    </section>

    <div v-if="showCreate" class="modal-mask" @click.self="showCreate = false">
      <form class="modal-card" @submit.prevent="submitCreate">
        <h3>登记发电量统计记录</h3>
        <p class="page-desc">同一统计周期重复填报时，以最后一版为准覆盖原记录。</p>
        <label v-for="field in formFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="form[field]" :placeholder="`请填写${field}（留空将显示暂无统计）`" />
        </label>
        <p v-if="formMessage" class="error-text">{{ formMessage }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="submit">保存填报</button>
          <button class="btn ghost" type="button" @click="showCreate = false">取消</button>
        </div>
      </form>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条发电量统计记录，覆盖 {{ periodTotal }} 个统计周期</span>
      <span v-if="actionMessage" class="success-text">{{ actionMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  armReadFailure,
  downloadEntries,
  getEntry,
  listEntries,
  moduleMeta,
  READ_ERROR_MESSAGE,
  recoverRows,
  runAction as applyAction,
  submitEntry,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('powerstat')
const columns = ['统计编号', '统计周期', '发电量', '上网电量', '厂用电率', '吨垃圾发电量', '填报人员', '统计状态']
const formFields = columns.filter((field) => field !== '统计状态')
const detailFields = columns
const actions = ['提交填报', '确认审核', '标记异常']
const statuses = ['待填报', '已填报', '已审核', '数据异常']
const EMPTY_TEXT = '暂无统计'

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const actionMessage = ref('')
const loadError = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function countByStatus(status: string): number {
  const periods = new Set(
    rows.value
      .filter((row) => String(row.status) === status)
      .map((row) => String(row['统计周期'] ?? '').trim())
      .filter((period) => period !== ''),
  )
  return periods.size
}

const periodTotal = computed(() => {
  const periods = new Set(
    rows.value.map((row) => String(row['统计周期'] ?? '').trim()).filter((period) => period !== ''),
  )
  return periods.size
})

const stats = computed(() => [
  { label: '统计周期总数', value: periodTotal.value },
  { label: '待填报周期', value: countByStatus('待填报') },
  { label: '已审核周期', value: countByStatus('已审核') },
  { label: '数据异常周期', value: countByStatus('数据异常') },
])

const hasActiveFilter = computed(() =>
  Object.values(filters.value).some((value) => value.trim() !== ''),
)
const activeFilterText = computed(() =>
  Object.entries(filters.value)
    .filter(([, value]) => value.trim() !== '')
    .map(([field, value]) => `${field} ${value.trim()}`)
    .join('、'),
)

function cellText(row: EntryRow, column: string): string {
  const value = row[column]
  return value === undefined || value === null || String(value).trim() === ''
    ? EMPTY_TEXT
    : String(value)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  try {
    downloadEntries(meta.key)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : READ_ERROR_MESSAGE
  }
}

const showCreate = ref(false)
const form = reactive<Record<string, string>>(
  Object.fromEntries(formFields.map((field) => [field, ''])),
)
const formMessage = ref('')

function openCreate() {
  for (const field of formFields) {
    form[field] = ''
  }
  formMessage.value = ''
  showCreate.value = true
}

function submitCreate() {
  const result = submitEntry(meta.key, { ...form })
  if (!result.ok) {
    formMessage.value = result.message
    return
  }
  showCreate.value = false
  actionMessage.value = result.message
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  actionMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  actionMessage.value = result.message
  reload()
  // 详情面板正开着且命中的就是这条记录时，跟着刷新结论
  if (detailState.value === 'ready' && detailRow.value?.id === row.id) {
    const refreshed = getEntry(meta.key, detailKeyword.value)
    detailRow.value = refreshed ?? detailRow.value
  }
}

function loadOnce() {
  const payload = listEntries(meta.key, filters.value)
  rows.value = payload.items
  total.value = payload.total
}

function reload() {
  errorMessage.value = ''
  loadError.value = ''
  try {
    loadOnce()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : READ_ERROR_MESSAGE
  }
}

function retryLoad() {
  try {
    loadOnce()
  } catch {
    // 再试一次还读不出来：回到示例数据兜底，保证列表、详情与概览的周期数对得上
    recoverRows()
    loadError.value = ''
    loadOnce()
  }
}

function simulateReadFailure() {
  armReadFailure()
  detailState.value = 'idle'
  reload()
}

type DetailState = 'idle' | 'ready' | 'empty' | 'error'
const detailState = ref<DetailState>('idle')
const detailRow = ref<EntryRow | null>(null)
const detailKeyword = ref('')

function fetchDetail(): boolean {
  const code = detailKeyword.value.trim()
  if (!code) {
    detailState.value = 'idle'
    detailRow.value = null
    return false
  }
  const hit = getEntry(meta.key, code)
  if (hit) {
    detailRow.value = hit
    detailState.value = 'ready'
    return true
  }
  detailRow.value = null
  detailState.value = 'empty'
  return false
}

function openDetail(row: EntryRow) {
  detailKeyword.value = String(row['统计编号'] ?? '')
  try {
    fetchDetail()
  } catch {
    detailState.value = 'error'
  }
}

function queryDetail() {
  try {
    fetchDetail()
  } catch {
    detailState.value = 'error'
  }
}

function retryDetail() {
  try {
    if (!fetchDetail()) {
      return
    }
  } catch {
    // 再试一次还读不出来：回到示例数据兜底后再查
    recoverRows()
    fetchDetail()
  }
}

onMounted(reload)
</script>
