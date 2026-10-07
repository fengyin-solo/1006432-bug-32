import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'waste-to-energy-plant:entries'

// 读不出来时统一抛这句，页面拿到后提示用户再试一次，别让空表冒充数据丢失
export const READ_ERROR_MESSAGE = '发电量统计数据取不到数，请重试一次'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 模拟下一次读取失败的开关：只作一次恶，点「再试一次」时就恢复，用它演示读取失败兜底
let failNextRead = false

export function armReadFailure(): void {
  failNextRead = true
  // 已在内存里的数据不算「读取」，清掉缓存，下一次访问才是真实的再读一次
  cache = null
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error(READ_ERROR_MESSAGE)
  }
  if (failNextRead) {
    failNextRead = false
    throw new Error(READ_ERROR_MESSAGE)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  // 解析失败说明存储里的内容已经坏掉：不悄悄吞掉，抛出去让页面提示并允许重试
  const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
  return { ...fallback, ...parsed }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

// 上一次读取失败后再试一次：还读不出来就回到示例数据兜底，保证重试后列表与概览都能对上
export function recoverRows(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  failNextRead = false
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
  }
  cache = fallback
  return cache
}

// 丢掉内存缓存，下一次读取重新走存储：用来模拟页面重新加载、验证读取失败兜底
export function resetReadCache(): void {
  cache = null
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
