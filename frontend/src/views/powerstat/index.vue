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
      </div>
    </header>

    <!-- 读取失败兜底：明确说取不到数，并给一次重试机会，不拿空表冒充没数据 -->
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
      </div>

      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <!-- 周期概览：把没数的月份也摆出来，给一句「暂无统计」，不留空白 -->
      <section class="period-board">
        <h3 class="board-title">统计周期概览</h3>
        <ul class="period-list">
          <li v-for="period in periodBoard" :key="period.period" class="period-item">
            <span class="period-name">{{ period.period }}</span>
            <template v-if="period.row">
              <span class="period-code">{{ period.row['统计编号'] }}</span>
              <span :class="['period-status', statusClass(period.row.status)]">{{ period.row.status }}</span>
              <button class="link" type="button" @click="openDetail(period.row)">查看详情</button>
            </template>
            <span v-else class="period-empty">暂无统计（该周期尚无填报记录）</span>
          </li>
        </ul>
      </section>

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
            <td v-for="column in columns" :key="column">{{ displayCell(row, column) }}</td>
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
          <!-- 空结果要把「查无记录」和「整库没数据」分开说，都不让用户误以为数据丢了 -->
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">
              <template v-if="hasActiveFilter">
                按当前条件（含统计编号 {{ activeFilterText }}）查不到任何发电量统计记录：该编号可能尚未填报，
                不是数据丢失，请核对编号后重试。
                <span class="empty-actions">
                  <button class="link" type="button" @click="resetFilters">清空条件</button>
                  <button class="link" type="button" @click="reload">再试一次</button>
                </span>
              </template>
              <template v-else>暂无统计：本周期还没有发电量统计数据，可先登记发电量统计记录</template>
            </td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ total }} 条发电量统计记录，覆盖 {{ coveredPeriods }} 个统计周期</span>
        <span class="foot-tools">
          <button class="link drill" type="button" @click="simulateReadFault">模拟取不到数（演练）</button>
          <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
        </span>
      </footer>
    </template>

    <!-- 登记/重新填报弹窗：同一统计周期重复填报只保留最后一版 -->
    <div v-if="creating" class="modal-mask" @click.self="closeCreate">
      <div class="modal">
        <h3>登记发电量统计记录</h3>
        <p class="modal-tip">同一统计周期重复填报时，以最后一版为准，原版本不再保留。</p>
        <div class="form-grid">
          <label v-for="field in editableFields" :key="field" class="form-item">
            <span>{{ field }}<em v-if="field === '填报人员' || field === '吨垃圾发电量'">*</em></span>
            <input
              v-model="formValues[field]"
              :type="field === '统计周期' ? 'month' : 'text'"
              :placeholder="field === '统计周期' ? '如 2026-10' : `请填写${field}`"
            />
          </label>
        </div>
        <p v-if="formError" class="error-text form-error">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">提交登记</button>
        </div>
      </div>
    </div>

    <!-- 详情弹窗：字段读不出值时逐格标注「暂无统计」，不再是一张让人误会的空表 -->
    <div v-if="detailRow" class="modal-mask" @click.self="detailRow = null">
      <div class="modal">
        <h3>发电量统计详情</h3>
        <table class="detail-table">
          <tbody>
            <tr v-for="field in detailFields" :key="field">
              <th>{{ field }}</th>
              <td :class="{ 'is-empty': isBlank(detailRow[field]) }">{{ displayCell(detailRow, field) }}</td>
            </tr>
            <tr>
              <th>当前状态</th>
              <td>{{ detailRow.status }}</td>
            </tr>
          </tbody>
        </table>
        <div class="modal-actions">
          <button class="btn" type="button" @click="detailRow = null">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  armReadFault,
  downloadEntries,
  listEntries,
  moduleMeta,
  reconcileEmissionReviews,
  runAction as applyAction,
  upsertEntry,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('powerstat')
const columns = ['统计编号', '统计周期', '发电量', '上网电量', '厂用电率', '吨垃圾发电量', '填报人员', '统计状态']
const actions = ['提交填报', '确认审核', '标记异常']
const statuses = ['待填报', '已填报', '已审核', '数据异常']
// 统计状态随流转动作自动维护，不由填报人手填。
const editableFields = columns.filter((field) => field !== '统计状态')
const detailFields = columns

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const loadError = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const creating = ref(false)
const formValues = ref<Record<string, string>>({})
const formError = ref('')
const detailRow = ref<EntryRow | null>(null)

const stats = computed(() => [
  { label: '待填报周期', value: countByStatus('待填报') },
  { label: '已审核周期', value: countByStatus('已审核') },
  { label: '数据异常周期', value: countByStatus('数据异常') },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: countByStatus(status),
  })),
)

const hasActiveFilter = computed(() =>
  Object.values(filters.value).some((value) => value.trim() !== ''),
)
const activeFilterText = computed(() => {
  const pair = Object.entries(filters.value).find(([, value]) => value.trim() !== '')
  return pair ? `「${pair[1].trim()}」` : ''
})

const coveredPeriods = computed(() => new Set(rows.value.map((row) => String(row['统计周期'] ?? '').trim()).filter(Boolean)).size)

function countByStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function isBlank(value: unknown): boolean {
  return String(value ?? '').trim() === ''
}

// 没数的字段统一兜底成「暂无统计」，空白格和读取失败一眼能区分。
function displayCell(row: EntryRow, field: string): string {
  const value = row[field]
  return isBlank(value) ? '暂无统计' : String(value)
}

function statusClass(status: string): string {
  if (status === '数据异常') {
    return 'is-abnormal'
  }
  if (status === '已审核') {
    return 'is-done'
  }
  return 'is-pending'
}

// 用记录里最早的统计周期到本月补齐月份，缺记录的月份也摆出来说一句「暂无统计」。
const periodBoard = computed(() => {
  const periods = rows.value
    .map((row) => String(row['统计周期'] ?? '').trim())
    .filter((period) => /^\d{4}-\d{2}$/.test(period))
    .sort()
  if (periods.length === 0) {
    return rows.value.map((row) => ({
      period: String(row['统计周期'] ?? '未标注周期'),
      row,
    }))
  }
  const byPeriod = new Map(rows.value.map((row) => [String(row['统计周期']).trim(), row]))
  const [startYear, startMonth] = periods[0].split('-').map(Number)
  const now = new Date()
  const endYear = now.getFullYear()
  const endMonth = now.getMonth() + 1
  const board: { period: string; row?: EntryRow }[] = []
  for (let year = startYear, month = startMonth; year < endYear || (year === endYear && month <= endMonth); ) {
    const period = `${year}-${String(month).padStart(2, '0')}`
    const row = byPeriod.get(period)
    board.push(row ? { period, row } : { period })
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return board
})

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  formValues.value = Object.fromEntries(editableFields.map((field) => [field, '']))
  formError.value = ''
  creating.value = true
}

function closeCreate() {
  creating.value = false
}

function submitCreate() {
  formError.value = ''
  // 填报人员或吨垃圾发电量空着的记录先卡在门外，并说明缺的是哪一项。
  const missing = ['填报人员', '吨垃圾发电量'].filter((field) => isBlank(formValues.value[field]))
  if (isBlank(formValues.value['统计周期'])) {
    missing.unshift('统计周期')
  }
  if (missing.length > 0) {
    formError.value = `缺少必填项「${missing.join('」「')}」，补齐后再提交`
    return
  }
  const result = upsertEntry(meta.key, { ...formValues.value })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  errorMessage.value = result.message
  creating.value = false
  reload()
}

function openDetail(row: EntryRow) {
  detailRow.value = row
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function simulateReadFault() {
  armReadFault()
  reload()
}

function reload() {
  loadError.value = ''
  errorMessage.value = ''
  try {
    // 先把已有填报结论对齐到环保监控待复核清单，再读本页，保证两边周期对得上。
    reconcileEmissionReviews()
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    rows.value = []
    total.value = 0
    loadError.value = error instanceof Error ? error.message : '取不到数：发电量统计读取失败，请再试一次'
  }
}

onMounted(reload)
</script>
