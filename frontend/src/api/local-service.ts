import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 发电量统计提交填报时必须先补齐的字段，缺一项都卡在门外。
const POWERSTAT_REQUIRED_FIELDS = ['填报人员', '吨垃圾发电量']
const POWERSTAT_KEY = 'powerstat'
const EMISSION_KEY = 'emission'

// 读取故障开关：置位后下一次读列表/概览会抛「取不到数」，读完一次自动复位，
// 用来模拟偶发的读取失败，方便页面上演练「再试一次」。
let readFaultPending = false

export function armReadFault(): void {
  readFaultPending = true
}

function assertReadable(): void {
  if (readFaultPending) {
    readFaultPending = false
    throw new Error('取不到数：数据暂时读取失败，请稍后再试一次')
  }
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

function isBlank(value: unknown): boolean {
  return String(value ?? '').trim() === ''
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
  assertReadable()
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function missingRequiredFields(meta: ModuleMeta, row: EntryRow): string[] {
  if (meta.key !== POWERSTAT_KEY) {
    return []
  }
  return POWERSTAT_REQUIRED_FIELDS.filter((field) => isBlank(row[field]))
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

  // 发电量统计的状态只能按 待填报→已填报→已审核→数据异常 逐级走，不能越级，也不能往后退。
  if (meta.strictFlow) {
    const fromIndex = meta.statuses.indexOf(current)
    const toIndex = meta.statuses.indexOf(target)
    if (toIndex === fromIndex) {
      return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
    }
    if (toIndex !== fromIndex + 1) {
      return {
        ok: false,
        message: `填报状态只能逐级流转，「${current}」不能直接跳到「${target}」，请先完成上一环节`,
      }
    }
  } else if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  // 提交填报前先把缺字段的记录挡回去，明确告诉用户缺的是哪一项。
  const missing = missingRequiredFields(meta, rows[index])
  if (missing.length > 0) {
    return {
      ok: false,
      message: `缺少必填项「${missing.join('」「')}」，补齐后再提交填报`,
    }
  }

  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal:
      (meta.key === POWERSTAT_KEY && target === '数据异常') ||
      NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)

  // 填报结论（已填报 / 已审核 / 数据异常）同步到环保监控的待复核清单。
  if (meta.key === POWERSTAT_KEY) {
    syncEmissionReview(updated)
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 登记记录：配了 uniqueField 的模块（发电量统计按统计周期）重复填报时不新增，
// 直接以最后一版覆盖原记录，保证同一周期只留最新一版。
export function upsertEntry(key: string, values: Record<string, string>): ActionResult {
  const meta = moduleMeta(key)
  const rows = [...listRows(key)]
  const uniqueField = meta.uniqueField
  const uniqueValue = uniqueField ? String(values[uniqueField] ?? '').trim() : ''
  if (uniqueField && !uniqueValue) {
    return { ok: false, message: `请先填写${uniqueField}，同一周期要靠它判断是否重复填报` }
  }
  const initialStatus = meta.statuses[0]
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const index = uniqueField
    ? rows.findIndex((row) => String(row[uniqueField]).trim() === uniqueValue)
    : -1

  // 填报人员或吨垃圾发电量空着的记录，登记这一关也先卡在门外，说明缺哪一项。
  const missing = POWERSTAT_REQUIRED_FIELDS.filter((field) => isBlank(values[field]))
  if (key === POWERSTAT_KEY && missing.length > 0) {
    return {
      ok: false,
      message: `缺少必填项「${missing.join('」「')}」，补齐后再提交填报`,
    }
  }

  // 只有覆盖的是一版已经报过/审过的记录，才算「重新填报」；初次填报仍挂普通待复核。
  const hadConclusion =
    index >= 0 && meta.key === POWERSTAT_KEY && String(rows[index].status) !== initialStatus
  const base: EntryRow =
    index >= 0
      ? rows[index]
      : ({ id: nextId(rows), status: initialStatus, pending: true, abnormal: false } as EntryRow)

  const updated: EntryRow = {
    ...base,
    ...Object.fromEntries(
      meta.fields.map((field) => [field, values[field] ?? String(base[field] ?? '')]),
    ),
    status: initialStatus,
    pending: initialStatus !== lastStatus,
    abnormal: false,
  }
  if (index >= 0) {
    rows[index] = updated
  } else {
    rows.push(updated)
  }
  saveRows(key, rows)

  if (key === POWERSTAT_KEY) {
    syncEmissionReview(updated, hadConclusion)
  }
  return {
    ok: true,
    message:
      index >= 0
        ? `统计周期「${uniqueValue}」已有填报，已按最后一版覆盖，原版本不再保留`
        : `${meta.entity}登记成功，当前状态「${initialStatus}」`,
  }
}

type ReviewConclusion = {
  label: string
  pending: boolean
  abnormal: boolean
  needsReview: boolean
}

// 发电量统计的填报状态如何反映到环保监控待复核清单。
function reviewConclusion(status: string, replaced: boolean): ReviewConclusion {
  switch (status) {
    case '已审核':
      return { label: '复核达标', pending: false, abnormal: false, needsReview: false }
    case '数据异常':
      return { label: '复核异常', pending: false, abnormal: true, needsReview: false }
    case '待填报':
      return {
        label: replaced ? '重新填报待复核' : '待复核',
        pending: true,
        abnormal: false,
        needsReview: true,
      }
    default:
      return { label: '待复核', pending: true, abnormal: false, needsReview: true }
  }
}

function buildReviewRow(id: number, powerstatRow: EntryRow, replaced: boolean): EntryRow {
  const period = String(powerstatRow['统计周期'] ?? '').trim()
  const conclusion = reviewConclusion(String(powerstatRow.status), replaced)
  return {
    id,
    status: conclusion.label,
    pending: conclusion.pending,
    abnormal: conclusion.abnormal,
    待复核: conclusion.needsReview,
    来源同步: true,
    来源模块: '发电量统计',
    统计周期: period,
    来源状态: String(powerstatRow.status),
    监控编号: `REV-PS-${period}`,
    监控指标: '吨垃圾发电量填报结论',
    限值要求: '以发电量统计填报数据为准',
    实测值: isBlank(powerstatRow['吨垃圾发电量'])
      ? '暂无统计'
      : String(powerstatRow['吨垃圾发电量']),
    达标判定: conclusion.label,
    监控日期: new Date().toISOString().slice(0, 10),
    监控人员: isBlank(powerstatRow['填报人员']) ? '待补报' : String(powerstatRow['填报人员']),
    监控状态: conclusion.label,
  }
}

// 把发电量统计的填报结论推到环保监控的待复核清单：同一统计周期只保留最新一条。
function syncEmissionReview(powerstatRow: EntryRow, replaced = false): void {
  const period = String(powerstatRow['统计周期'] ?? '').trim()
  if (!period) {
    return
  }
  const emissionRows = [...listRows(EMISSION_KEY)]
  // 同一周期重新填报：先撤下之前同步过去的结论（含人工复核后的），再挂最新这一版。
  const remaining = emissionRows.filter(
    (row) =>
      row.来源同步 !== true || String(row['统计周期'] ?? '') !== period,
  )
  remaining.push(buildReviewRow(nextId(remaining), powerstatRow, replaced))
  saveRows(EMISSION_KEY, remaining)
}

// 打开页面时对账一遍：已有发电量统计周期都应有对应的待复核结论；
// 已经在环保侧人工复核且填报状态没变的结论保留不动；统计侧已经没有的周期撤下。
export function reconcileEmissionReviews(): void {
  assertReadable()
  const powerstatRows = listRows(POWERSTAT_KEY)
  if (powerstatRows.length === 0) {
    return
  }
  const emissionRows = [...listRows(EMISSION_KEY)]
  const byPeriod = new Map(powerstatRows.map((row) => [String(row['统计周期'] ?? '').trim(), row]))
  const kept = emissionRows.filter((row) => {
    if (row.来源同步 !== true) {
      return true
    }
    const period = String(row['统计周期'] ?? '').trim()
    const source = byPeriod.get(period)
    if (!source) {
      return false
    }
    // 人工已复核且统计状态没有再变化，保留这条结论不动。
    return row.待复核 !== true && String(row['来源状态'] ?? '') === String(source.status)
  })
  const syncedPeriods = new Set(
    kept
      .filter((row) => row.来源同步 === true)
      .map((row) => String(row['统计周期'] ?? '').trim()),
  )
  for (const [period, source] of byPeriod) {
    if (period && !syncedPeriods.has(period)) {
      kept.push(buildReviewRow(nextId(kept), source, false))
    }
  }
  saveRows(EMISSION_KEY, kept)
}

// 环保监控对待复核清单给出复核结论，结掉后该条离开待复核清单。
export function resolveEmissionReview(id: number, verdict: '达标' | '异常'): ActionResult {
  const rows = [...listRows(EMISSION_KEY)]
  const index = rows.findIndex((row) => Number(row.id) === id && row.待复核 === true)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的待复核记录` }
  }
  const target = verdict === '达标' ? '已达标' : '未达标'
  rows[index] = {
    ...rows[index],
    status: target,
    待复核: false,
    pending: false,
    abnormal: verdict === '异常',
    达标判定: verdict === '达标' ? '复核达标' : '复核异常',
    监控状态: target,
  }
  saveRows(EMISSION_KEY, rows)
  return { ok: true, message: `已完成复核，结论「${target}」，该条已移出待复核清单` }
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

// 发电量统计覆盖的统计周期数：列表与概览都用它对账，重试前后要能对上。
export function powerstatPeriodCount(rows: EntryRow[] = listRows(POWERSTAT_KEY)): number {
  return new Set(rows.map((row) => String(row['统计周期'] ?? '').trim()).filter(Boolean)).size
}

export function loadOverview(): OverviewResult {
  assertReadable()
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    { label: '发电量统计周期数', value: powerstatPeriodCount() },
  ]
  return { cards, modules }
}
