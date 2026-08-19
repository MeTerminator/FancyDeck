/**
 * 「时间与日期」插件的数据形状，服务端与前端共用。
 *
 * 时间、日期、星期、农历、干支、节气、宜忌全部在客户端本地算（见 lunar.ts），
 * 不需要任何上报。这里放的是**覆盖值**：留空就用算出来的，
 * 想接更权威的通书或加自定义节日时才 POST 上来。
 */

export type DateTimeState = {
  /** 宜；留空则用建除十二神算出来的那份 */
  suitable: string[]
  /** 忌；留空则用建除十二神算出来的那份 */
  avoid: string[]
  /** 节日 / 纪念日，显示在节气那行前面 */
  festival: string
  updatedAt: number
}

export const defaultDateTime: DateTimeState = {
  suitable: [],
  avoid: [],
  festival: '',
  updatedAt: 0,
}
