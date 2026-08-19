/** 天气插件的数据形状，服务端与前端共用。 */

export type WeatherState = {
  city: string
  condition: string
  temperature: number
  feelsLike: number
  humidity: number
  low: number
  high: number
  /** 空气质量指数；0 表示没取到 */
  aqi: number
  /** 优 / 良 / 轻度污染……，aqi 为 0 时是空串 */
  aqiLevel: string
  updatedAt: number
}

export const defaultWeather: WeatherState = {
  city: '杭州',
  condition: '晴',
  temperature: 26,
  feelsLike: 28,
  humidity: 58,
  low: 22,
  high: 31,
  aqi: 0,
  aqiLevel: '',
  updatedAt: 0,
}
