/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ActionRule = {
  // 只允许从这些状态发起该动作，不在名单里就是越级流转
  from?: string[]
  // 发起动作前必须非空的字段，缺一项都不放行
  required?: string[]
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  // 动作级规则：允许的来源状态、必填字段，页面不做业务判断，全部集中在这里
  actionRules?: Record<string, ActionRule>
  // 走到这些状态就算办结（不再挂待办）；不配则默认最后一个状态为办结
  doneStatuses?: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
