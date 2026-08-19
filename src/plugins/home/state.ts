/** 智能家居插件的数据形状，服务端与前端共用。 */

export type HomeDevice = {
  id: string
  name: string
  kind: 'light' | 'climate' | 'switch'
  on: boolean
  /** 灯是亮度百分比，空调是设定温度 */
  value: number
}

export type HomeState = {
  room: string
  devices: HomeDevice[]
  updatedAt: number
}

export const defaultHome: HomeState = {
  room: '客厅',
  devices: [
    { id: 'light', name: '客厅主灯', kind: 'light', on: true, value: 60 },
    { id: 'ac', name: '空调', kind: 'climate', on: true, value: 26 },
  ],
  updatedAt: 0,
}
