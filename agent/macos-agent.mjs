#!/usr/bin/env node
/**
 * FancyDeck macOS 采集端。
 *
 * 它负责把系统里的信息上报给服务端。它跑在你的 Mac 上，屏幕可以是另一台设备。
 *
 *   node agent/macos-agent.mjs                     # 连本机 8787
 *   FANCYDECK_URL=http://192.168.1.10:8787 node agent/macos-agent.mjs
 *
 * 做三件事：
 *   1. 每 2 秒读一次 Music.app / Spotify 的播放状态，推给 media 插件
 *   2. 每 5 分钟读一次 Calendar.app 未来一天的日程，推给 agenda 插件
 *
 * 首次运行 macOS 会弹窗要「自动化」与「日历」权限，同意即可。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

const BASE = process.env.FANCYDECK_URL ?? 'http://localhost:8787'
const MEDIA_INTERVAL = Number(process.env.FANCYDECK_MEDIA_INTERVAL ?? 2000)
const AGENDA_INTERVAL = Number(process.env.FANCYDECK_AGENDA_INTERVAL ?? 300_000)

/** AppleScript 里用 ASCII 31 分隔字段、ASCII 30 分隔记录，曲名带引号也不会把解析搞坏 */
const FIELD = '\x1f'
const RECORD = '\x1e'

/** 优先读哪个播放器；第一个正在播放的赢 */
const PLAYERS = ['Music', 'Spotify']

const osa = async (script, timeout = 8000) => {
  const { stdout } = await exec('osascript', ['-e', script], { timeout, maxBuffer: 4 << 20 })
  return stdout.trim()
}

const quiet = async (script, timeout) => {
  try {
    return await osa(script, timeout)
  } catch {
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 媒体
// ────────────────────────────────────────────────────────────────────────────

const nowPlayingScript = (app) => `
if application "${app}" is running then
  tell application "${app}"
    if player state is stopped then
      return "stopped"
    end if
    set t to current track
    return (player state as string) & (ASCII character 31) & ¬
      (name of t as string) & (ASCII character 31) & ¬
      (artist of t as string) & (ASCII character 31) & ¬
      (album of t as string) & (ASCII character 31) & ¬
      ((duration of t) as string) & (ASCII character 31) & ¬
      ((player position) as string)
  end tell
else
  return "notrunning"
end if`

/** 封面：AppleScript 把二进制原样吐成 «data XXXXhex…»，这里切出 hex 再还原 */
async function fetchArtwork(app) {
  const raw = await quiet(
    `tell application "${app}" to get raw data of artwork 1 of current track`,
    12_000,
  )
  if (!raw) return null
  const match = raw.match(/«data (\w{4})([0-9A-Fa-f]+)»/)
  if (!match) return null
  const [, type, hex] = match
  const mime = type === 'PNGf' ? 'image/png' : type === 'JPEG' ? 'image/jpeg' : 'image/tiff'
  try {
    return `data:${mime};base64,${Buffer.from(hex, 'hex').toString('base64')}`
  } catch {
    return null
  }
}

async function readNowPlaying() {
  for (const app of PLAYERS) {
    const out = await quiet(nowPlayingScript(app), 6000)
    if (!out || out === 'notrunning' || out === 'stopped') continue

    const [state, title, artist, album, durationRaw, positionRaw] = out.split(FIELD)
    if (!title) continue

    // Spotify 的时长是毫秒，Music 是秒
    const duration = Number(durationRaw) || 0
    return {
      app,
      playing: state === 'playing',
      title,
      artist: artist ?? '',
      album: album ?? '',
      durationSec: app === 'Spotify' ? Math.round(duration / 1000) : Math.round(duration),
      positionSec: Number(positionRaw) || 0,
    }
  }
  return null
}

// ────────────────────────────────────────────────────────────────────────────
// 日历
// ────────────────────────────────────────────────────────────────────────────

const agendaScript = `
set out to ""
set now to current date
set horizon to now + (1 * days)
tell application "Calendar"
  repeat with c in calendars
    tell c
      set found to (every event whose start date ≥ now and start date ≤ horizon)
      repeat with e in found
        set out to out & (uid of e) & (ASCII character 31) & ¬
          (summary of e) & (ASCII character 31) & ¬
          ((start date of e) as «class isot» as string) & (ASCII character 31) & ¬
          ((end date of e) as «class isot» as string) & (ASCII character 31) & ¬
          (location of e as string) & (ASCII character 31) & ¬
          (title of c) & (ASCII character 30)
      end repeat
    end tell
  end repeat
end tell
return out`

let agendaWarned = false

async function readAgenda() {
  // 日历脚本慢，给它宽裕的超时；读不到就当没有，不影响其它数据
  const out = await quiet(agendaScript, 45_000)
  if (out === null) {
    // 最常见的原因是没给自动化权限，macOS 这时报的是「应用没在运行」，很容易看岔
    if (!agendaWarned) {
      agendaWarned = true
      console.warn(
        '[agent] 读不到日历。去「系统设置 → 隐私与安全性 → 自动化」里，' +
          '把运行本脚本的终端对「日历」的开关打开，然后重启本脚本。',
      )
    }
    return null
  }
  return out
    .split(RECORD)
    .filter(Boolean)
    .map((row) => {
      const [id, title, start, end, location, calendar] = row.split(FIELD)
      return {
        id,
        title,
        start: Date.parse(start),
        end: Date.parse(end),
        location: location === 'missing value' ? undefined : location,
        calendar,
      }
    })
    .filter((e) => Number.isFinite(e.start))
    .sort((a, b) => a.start - b.start)
}

// ────────────────────────────────────────────────────────────────────────────
// 上报与循环
// ────────────────────────────────────────────────────────────────────────────

let lastTrackKey = null
let lastArtwork = null

const post = async (path, body) => {
  try {
    await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // 服务端没起来就静静等下一轮
  }
}

async function pushMedia() {
  const track = await readNowPlaying()

  if (!track) {
    if (lastTrackKey !== null) {
      lastTrackKey = null
      lastArtwork = null
      await post('/api/p/media/stopped', {})
    }
    return
  }

  const key = `${track.app}|${track.title}|${track.artist}`

  // 封面只在换歌时取一次——它是这里最贵的一步
  if (key !== lastTrackKey) {
    lastTrackKey = key
    lastArtwork = await fetchArtwork(track.app)
  }

  await post('/api/p/media/now-playing', { ...track, artwork: lastArtwork })
}

async function pushAgenda() {
  const events = await readAgenda()
  if (events === null) return
  await post('/api/p/agenda/events', { events })
  console.log(`[agent] 日程 ${events.length} 条`)
}

console.log(`[agent] FancyDeck macOS 采集端 → ${BASE}`)

// 轮询用 setTimeout 串起来，避免上一次 osascript 还没回来就发起下一次
const loop = async (fn, interval) => {
  for (;;) {
    try {
      await fn()
    } catch (error) {
      console.error('[agent]', error.message)
    }
    await new Promise((r) => setTimeout(r, interval))
  }
}

void loop(pushMedia, MEDIA_INTERVAL)
void loop(pushAgenda, AGENDA_INTERVAL)
