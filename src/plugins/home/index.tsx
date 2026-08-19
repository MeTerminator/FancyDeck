import { definePlugin } from '../../core/plugin'
import { BulbIcon, SnowflakeIcon } from '../../ui/icons'
import { Tile } from '../../ui/Tile'
import { defaultHome, type HomeDevice, type HomeState } from './state'

/**
 * 智能家居插件。它演示的是「卡片能往回发指令」：
 * 点击设备行走的是 command('toggleDevice')，由服务端转给真正能控制设备的采集端。
 */

function DeviceRow({ device, onToggle }: { device: HomeDevice; onToggle: () => void }) {
  const Icon = device.kind === 'climate' ? SnowflakeIcon : BulbIcon
  const color = device.on ? 'var(--fd-accent)' : 'var(--fd-text-muted)'
  const state = device.on
    ? device.kind === 'light'
      ? `已开启 · ${device.value}%`
      : device.kind === 'climate'
        ? `制冷 · ${device.value}°`
        : '已开启'
    : '已关闭'

  return (
    <button
      type="button"
      className="fd-devrow"
      onClick={onToggle}
      aria-pressed={device.on}
      aria-label={`${device.name}，${state}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Icon size="clamp(20px, 3vmin, 38px)" color={color} />
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: device.on ? 'var(--fd-accent)' : 'transparent',
            border: device.on ? 'none' : '1px solid var(--fd-line)',
          }}
        />
      </div>
      <div
        className="fd-heading"
        style={{
          fontSize: 'clamp(15px, 2.4vmin, 30px)',
          color: device.on ? 'var(--fd-text-primary)' : 'var(--fd-text-secondary)',
        }}
      >
        {device.name}
      </div>
      {device.kind === 'light' ? (
        <div className="fd-bar">
          <div className="fd-bar__fill" style={{ width: device.on ? `${device.value}%` : '0%' }} />
        </div>
      ) : (
        <div className="fd-row">
          <span className="fd-display" style={{ fontSize: 'clamp(18px, 2.8vmin, 36px)' }}>
            {device.on ? `${device.value}°` : '—'}
          </span>
        </div>
      )}
      <div className="fd-muted" style={{ fontSize: 'clamp(10px, 1.3vmin, 14px)' }}>
        {state}
      </div>
    </button>
  )
}

export default definePlugin<HomeState>({
  id: 'home',
  name: '智能家居',
  description: '房间里的灯与空调，点一下就能开关。',
  icon: 'Lamp',
  defaultState: defaultHome,

  routes: [
    { method: 'POST', path: '/api/p/home/devices', description: '上报设备列表与状态' },
    { method: 'GET', path: '/api/p/home/state', description: '读设备状态' },
  ],

  cards: [
    {
      id: 'devices',
      name: '设备列表',
      description: '一格里竖排若干设备',
      size: { minCols: 1, minRows: 1, defaultCols: 1, defaultRows: 2 },
      render: ({ state, command, patchState, span }) => {
        const limit = Math.max(1, span.rows)
        const toggle = (id: string) => {
          // 先本地翻转，屏幕立刻响应；服务端处理完会把真实状态推回来
          patchState({ devices: state.devices.map((d) => (d.id === id ? { ...d, on: !d.on } : d)) })
          command('toggleDevice', { id })
        }
        return (
          <Tile label={state.room}>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
              {state.devices.slice(0, limit * 2).map((device, index) => (
                <div key={device.id} style={{ display: 'contents' }}>
                  {index > 0 && <div className="fd-rule" style={{ flexShrink: 0 }} />}
                  <DeviceRow device={device} onToggle={() => toggle(device.id)} />
                </div>
              ))}
            </div>
          </Tile>
        )
      },
    },
  ],

  triggers: [
    {
      id: 'any-on',
      name: '有设备开着时',
      evaluate: ({ state }) => state.devices.some((d) => d.on),
    },
  ],
})
