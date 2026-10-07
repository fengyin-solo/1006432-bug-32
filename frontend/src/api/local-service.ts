import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  armReadFailure,
  listRows,
  READ_ERROR_MESSAGE,
  recoverRows,
  resetRows,
  saveRows,
} from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export { READ_ERROR_MESSAGE, armReadFailure, recoverRows }

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function isDone(meta: ModuleMeta, status: string): boolean {
  return meta.doneStatuses
    ? meta.doneStatuses.includes(status)
    : status === meta.statuses[meta.statuses.length - 1]
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  // 越级流转先挡住：例如发电量统计只准从待填报直接标记数据异常
  const rule = meta.actionRules?.[action]
  if (rule?.from && !rule.from.includes(current)) {
    return {
      ok: false,
      message: `${meta.entity}当前为「${current}」，不能直接「${action}」，请按待填报→已填报→已审核的顺序流转`,
    }
  }
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 必填字段缺一项都不放行，并说明缺的是哪一项
  if (rule?.required) {
    const missing = rule.required.filter(
      (field) => String(rows[index][field] ?? '').trim() === '',
    )
    if (missing.length > 0) {
      return { ok: false, message: `无法${action}：${missing.join('、')}还没填写，请补齐后再提交` }
    }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !isDone(meta, target),
    abnormal:
      target.includes('异常') || NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

function nextSerial(rows: EntryRow[]): string {
  const maxId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  return `POWE-${String(maxId + 1).padStart(4, '0')}`
}

// 登记发电量统计：同一统计周期重复填报只保留最新一版，以最后一版为准
export function submitEntry(key: string, values: Record<string, string>): ActionResult & { id?: number } {
  const meta = moduleMeta(key)
  const period = String(values['统计周期'] ?? '').trim()
  if (!period) {
    return { ok: false, message: '无法登记：统计周期不能为空' }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => String(row['统计周期'] ?? '').trim() === period)
  const cleaned: Record<string, string> = {}
  for (const field of meta.fields) {
    cleaned[field] = String(values[field] ?? '').trim()
  }
  if (!cleaned['统计编号']) {
    cleaned['统计编号'] = nextSerial(rows)
  }
  cleaned['统计状态'] = '待填报'

  if (index >= 0) {
    const replaced: EntryRow = {
      ...rows[index],
      ...cleaned,
      status: '待填报',
      pending: !isDone(meta, '待填报'),
      abnormal: false,
    }
    const next = [...rows]
    next[index] = replaced
    saveRows(key, next)
    return { ok: true, message: `统计周期 ${period} 已有填报，已用最新一版覆盖`, id: Number(replaced.id) }
  }

  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const created: EntryRow = {
    id,
    ...cleaned,
    status: '待填报',
    pending: !isDone(meta, '待填报'),
    abnormal: false,
  }
  saveRows(key, [...rows, created])
  return { ok: true, message: `已登记统计周期 ${period} 的发电量统计记录`, id }
}

// 按统计编号取详情：查不到明确说没有，读不出来抛错让页面提示重试
export function getEntry(key: string, keyword: string): EntryRow | null {
  const code = keyword.trim()
  if (!code) {
    return null
  }
  const hit = listRows(key).find((row) => String(row['统计编号'] ?? '').includes(code))
  return hit ?? null
}

// 发电量统计的填报结论同步到环保监控的待复核清单：已填报待复核、数据异常重点复核
export function pendingReviewItems(): {
  rows: EntryRow[]
  total: number
} {
  const rows = listRows('powerstat').filter((row) => {
    const status = String(row.status)
    return status === '已填报' || status === '数据异常'
  })
  return { rows, total: rows.length }
}

// 概览与列表共用的周期口径：同一统计周期重复填报只算一个周期
export function distinctPeriodCount(key: string): number {
  const periods = new Set(
    listRows(key)
      .map((row) => String(row['统计周期'] ?? '').trim())
      .filter((period) => period !== ''),
  )
  return periods.size
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult & { periodCount: number } {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => !isDone(meta, String(row.status))).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules, periodCount: distinctPeriodCount('powerstat') }
}
