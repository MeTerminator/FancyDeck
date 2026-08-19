/** 日程插件的数据形状，服务端与前端共用。 */

export type AgendaEvent = {
  id: string
  title: string
  /** epoch ms */
  start: number
  end?: number
  location?: string
  calendar?: string
  allDay?: boolean
}

export type AgendaState = {
  events: AgendaEvent[]
  updatedAt: number
}

export const emptyAgenda: AgendaState = { events: [], updatedAt: 0 }

/** 下一件还没开始（或正在进行）的事 */
export function nextEvent(state: AgendaState, now: number): AgendaEvent | null {
  return state.events.find((e) => (e.end ?? e.start + 30 * 60_000) > now) ?? null
}

/** 距离开始还有多少分钟；已经开始了给负数 */
export const minutesUntil = (event: AgendaEvent, now: number) => (event.start - now) / 60_000
