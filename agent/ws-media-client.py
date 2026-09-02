#!/usr/bin/env python3
"""
把 MeT-Music 正在放的歌搬到 FancyDeck 上。

一端接 MeT-Music 客户端的「外部 API」（本机 HTTP + WebSocket，默认
127.0.0.1:14558），一端连 FancyDeck 媒体插件的长连接：

    连上 + 发 play  →  屏幕上开始播
    定时发 progress →  进度条与歌词跟着走
    发 stop 或断开  →  屏幕上停

最后那条是用长连接的理由：播放器崩了、网断了、进程被 kill 了，
屏幕不会继续挂着一首根本没在响的歌。

暂停也算「不在响」，只是没那么急：暂停超过 --idle-stop 秒（默认 10）
就发 stop 把屏幕让出去，回到普通 deck；等重新播放再把曲目和歌词发一遍占回来。

该采集端只向 FancyDeck 上报播放状态，不接收或执行控制指令。

用法：
    python3 agent/ws-media-client.py                  # 跟随本机 MeT-Music
    python3 agent/ws-media-client.py --transport poll # 不用 WebSocket，纯轮询
    python3 agent/ws-media-client.py --idle-stop 30   # 暂停 30 秒才让出屏幕

先在 MeT-Music 里打开「设置 → 外部 API」；里面还有个单独的 WebSocket 开关，
开了就走事件推送，没开自动退回轮询 /api/now-playing。

歌词转成行级 LRC 发给 FancyDeck；翻译用与正文相同的时间戳紧跟在下一行。

依赖：pip install websockets
"""

import argparse
import asyncio
import json
import sys
import time
from functools import partial
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

try:
    import websockets
    from websockets.exceptions import WebSocketException
except ImportError:
    sys.exit("缺少依赖：pip install websockets")

DEFAULT_URL = "ws://localhost:8787/ws/p/media"

# 进度上报的防抖：距上一条不到这个时间就不发了。
# 屏幕自己会补齐两次上报之间的进度，发太密既没有更准也没有更快。
PROGRESS_DEBOUNCE = 0.3

# ── MeT-Music 外部 API ───────────────────────────────────────────────────────
# 客户端「设置 → 外部 API」开出来的本地接口，HTTP 与 WebSocket 共用一个端口：
#     GET  /api/info | /api/status | /api/now-playing | /api/lyrics
#     WS   /ws   服务端推 hello/event/ack/error，客户端发 {op: …}
# 时间单位一律毫秒，这边要换算成秒才能给 FancyDeck。
MET_HOST = "127.0.0.1"
MET_PORT = 14558
# WebSocket 是在外部 API 之上另开的开关，没开就退回轮询 /api/now-playing
POLL_INTERVAL = 1.0
# 轮询期间每隔这么久回头试一次 WebSocket——用户中途把开关打开也能接上
WS_RETRY = 30.0
# HTTP 请求超时。都是本机回环，慢成这样基本就是没人应答了。
HTTP_TIMEOUT = 5.0

# 暂停超过这么久就把屏幕让出去，回到普通 deck；重新播放再占回来
IDLE_STOP = 10.0
# 以为在播、却这么久没等到任何事件，就主动去问一次 /api/status。
# 有的版本暂停后既不推 state 也不推 progress，只能靠这个发现。
STALL_AFTER = 3.0
# 两次纠错查询之间至少隔这么久，免得每条 progress 都去问一遍
RECHECK_INTERVAL = 2.0
# 切歌后等歌词换成新那首的最长时间，以及每次重试的间隔
LYRIC_WAIT = 6.0
LYRIC_RETRY = 0.4
# 客户端报的这些状态都当「停了」
STOPPED_STATES = ("", "stopped", "idle", "none")


# ════════════════════════════════════════════════════════════════════════════
# 歌词
# ════════════════════════════════════════════════════════════════════════════


def stamp(seconds: float) -> str:
    seconds = max(0.0, seconds)
    return f"{int(seconds // 60):02d}:{seconds % 60:06.3f}"


def lyrics_fingerprint(payload: dict) -> str:
    """
    一份歌词的指纹。

    切歌那一下客户端往往还没把新歌词加载好，/api/lyrics 会先把上一首那份
    原样回给你。指纹用来认出「这还是刚才那份」，等到真换了再往屏幕上发。
    """
    lines = payload.get("lines") or []
    if not lines:
        return ""
    head, tail = lines[0], lines[-1]
    return "|".join(str(part) for part in (
        payload.get("source"), len(lines),
        head.get("time"), head.get("content"), tail.get("time"), tail.get("content"),
    ))


def lyrics_to_lrc(payload: dict) -> tuple[str, str]:
    """
    GET /api/lyrics 的解析结果 → 行级 LRC。返回 (lrc, 来源说明)。

    接口已经把歌词拆好了，这边只保留每行的开始时间：

        source=yrc   丢弃逐字时间，合并成一行
        source=lrc   直接保留行级时间轴
        source=none  没歌词

    line.tran（翻译）使用与正文相同的时间戳紧跟在下一行。FancyDeck 将同时间戳
    的第二条文本合并为该行的可选翻译，这仍是普通 LRC 阅读器能识别的格式。
    """
    lines = payload.get("lines") or []
    source = str(payload.get("source") or "none")
    if source == "none" or not lines:
        return "", "没有歌词"

    # offset 是客户端里那个歌词偏移设置。按 LRC 的老规矩正值表示提前，
    # 所以是减不是加。要是方向反了，用 --offset 往回补一点就行。
    shift = float(payload.get("offset") or 0) / 1000
    parts = []
    translated = 0
    for line in lines:
        content = str(line.get("content") or "")
        words = line.get("words") or []
        if not content.strip() and words:
            content = "".join(str(word.get("content") or "") for word in words)
        content = content.strip()
        if not content:
            continue

        begin = float(line.get("time") or 0) / 1000 - shift
        timestamp = f"[{stamp(begin)}]"
        parts.append(f"{timestamp}{content.replace(chr(10), ' ').replace(chr(13), ' ')}")

        tran = str(line.get("tran") or "").strip()
        if tran and tran != content:
            parts.append(f"{timestamp}{tran.replace(chr(10), ' ').replace(chr(13), ' ')}")
            translated += 1

    if not parts:
        return "", "没有歌词"

    note = f"{source} → LRC（{len(lines)} 条，{translated} 条翻译）"
    if shift:
        note += f"，偏移 {shift * 1000:.0f}ms"
    return "\n".join(parts), note


# ════════════════════════════════════════════════════════════════════════════
# 与 FancyDeck 的那一端
# ════════════════════════════════════════════════════════════════════════════


class FancyDeckLink:
    """只向 FancyDeck 发送播放状态与歌词。"""

    def __init__(self, url: str):
        self.url = url
        self.ws = None
        self._last_progress = 0.0

    async def __aenter__(self):
        self.ws = await websockets.connect(self.url)
        print(f"已连上 FancyDeck {self.url}")
        return self

    async def __aexit__(self, *_):
        if self.ws:
            await self.ws.close()

    async def send(self, message: dict):
        if self.ws is None:
            return
        try:
            await self.ws.send(json.dumps(message, ensure_ascii=False))
        except websockets.ConnectionClosed:
            pass

    async def play(self, track: dict, position: float = 0.0):
        self._last_progress = time.monotonic()
        await self.send({"type": "play", **track, "positionSec": round(position, 2)})

    async def lyrics(self, lrc: str):
        await self.send({"type": "lyrics", "lrc": lrc})

    async def progress(self, position: float, *, force: bool = False, **extra) -> bool:
        """
        报进度。收到 progress 就意味着「在播」，服务端那头不带 playing 即按在播处理。

        距上一条不到 PROGRESS_DEBOUNCE 就直接跳过——屏幕自己会补齐两次上报之间的
        进度，多发几条既没有更准也没有更快。指令的执行回报要即时，用 force 绕过。
        """
        now = time.monotonic()
        if not force and now - self._last_progress < PROGRESS_DEBOUNCE:
            return False
        self._last_progress = now
        await self.send({"type": "progress", "positionSec": round(position, 2), **extra})
        return True

    async def stop(self):
        self._last_progress = 0.0
        await self.send({"type": "stop"})


# ════════════════════════════════════════════════════════════════════════════
# MeT-Music
# ════════════════════════════════════════════════════════════════════════════


class MetMusicSource:
    """
    跟着本机 MeT-Music 客户端走，接它的「外部 API」（默认 127.0.0.1:14558）。

    取数走 HTTP，事件走 WebSocket（ws://…/ws）。WebSocket 在客户端里是
    外部 API 之上另一个开关，没开就退回每秒轮询 /api/now-playing——
    行为一样，只是延迟大一点，并且每隔一会儿回头再试一次 WS。

    「在播 / 暂停 / 停了」这三态是这个类的全部要点：

        在播    报 progress，屏幕跟着走
        暂停    报一条 playing=false，然后闭嘴；超过 idle_stop 秒就发 stop 让出屏幕
        停了    发 stop，屏幕立刻退回普通 deck

    状态以客户端说的为准，但不全信它一定会说：以为在播却久久没有动静，
    就自己去问一次 /api/status（见 _recheck）。
    """

    def __init__(self, host: str, port: int, *, offset: float = 0.0,
                 transport: str = "auto", idle_stop: float = IDLE_STOP):
        self.base = f"http://{host}:{port}/api"
        self.ws_url = f"ws://{host}:{port}/ws"
        self.offset = offset
        self.transport = transport
        self.idle_stop = idle_stop
        self.link: FancyDeckLink | None = None

        # 最近一次已知的完整快照。WS 的 state/progress 事件只带进度，
        # 曲目字段要从这里补，所以事件是往它上面打补丁而不是替换。
        self.snapshot: dict = {}
        self.mid = ""
        self.playing = False
        # 进入暂停的时刻（monotonic），None 表示没在暂停
        self.paused_at: float | None = None
        # 暂停太久，已经把屏幕让给普通 deck 了
        self.retired = False
        # 当前曲目与它的歌词。让出屏幕之后重新播放要把这两样再发一遍。
        self.track: dict = {}
        self.lrc = ""
        self._lyric_fingerprint = ""
        self._lyric_task: asyncio.Task | None = None

        self._last_signal = 0.0
        self._last_recheck = 0.0
        # 最近一次报过的故障。接口没开时每秒都会失败一次，
        # 一样的话就不重复刷屏了，恢复了再说一声。
        self._fault: str | None = None
        # WS 连不上的提示同理，说一次就够，连上过之后再断才重新提醒
        self._ws_warned = False
        # 显式绕开系统代理。开着代理软件时 urlopen 默认会把 127.0.0.1 也送进代理，
        # 拿回来的是代理的 503 而不是播放器的响应。
        self._opener = build_opener(ProxyHandler({}))

    # ── HTTP ────────────────────────────────────────────────────────────
    def _fail(self, note: str):
        if note != self._fault:
            print(f"\n  ⚠ {note}")
        self._fault = note

    def _request(self, path: str, method: str, body: dict | None) -> dict | None:
        """一次 HTTP 调用。失败返回 None——取不到数不该把整条链路带崩。"""
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = Request(
            self.base + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json"} if data else {},
        )
        try:
            with self._opener.open(request, timeout=HTTP_TIMEOUT) as response:
                raw = response.read().decode("utf-8")
            if self._fault:
                print(f"\n  ✓ {self.base} 又通了")
                self._fault = None
            return json.loads(raw) if raw.strip() else {}
        except HTTPError as error:
            reason = {
                400: "参数非法",
                404: "接口不存在（客户端版本对不上？）",
                501: "播放器未就绪（主窗没加载或 UI 版本过旧）",
            }.get(error.code, error.reason)
            self._fail(f"{method} {path} → {error.code} {reason}")
        except (URLError, OSError, ValueError) as error:
            self._fail(f"{method} {path} 失败：{error}")
        return None

    async def _api(self, path: str, *, method: str = "GET", body: dict | None = None):
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, partial(self._request, path, method, body))

    # ── 曲目与歌词 ──────────────────────────────────────────────────────
    async def _switch_song(self, snapshot: dict, position: float, playing: bool):
        """
        换歌：曲目先发过去，歌词交给后台慢慢等（见 _load_lyrics）。

        换过去的这首要是暂停着的（比如断线重连时人早就按了暂停），
        就只在本地记下曲目，不占屏幕——真播起来了再由 _resume 发出去。
        """
        self.mid = str(snapshot.get("id") or "")
        self.playing = playing
        self.paused_at = None
        self.retired = not playing
        self.track = {
            "title": snapshot.get("name") or "未知曲目",
            "artist": snapshot.get("artist") or "未知歌手",
            "album": snapshot.get("album") or "",
            "artwork": snapshot.get("cover") or None,
            "durationSec": float(snapshot.get("duration") or 0) / 1000,
            "app": "MeT-Music",
        }
        self.lrc = ""
        if playing:
            await self.link.play(self.track, position)
            print(f"\n→ play  {self.track['title']} — {self.track['artist']}"
                  f"  ({self.track['durationSec']:.0f}s)")
            # 上一首的歌词立刻清掉。服务端只在标题变了才自动清，
            # 而且新歌词还得等一会儿才到——空着也比挂着上一首的强。
            await self.link.lyrics("")
        else:
            print(f"\n→ 新曲目 {self.track['title']}（暂停中，先不占屏幕）")

        if self._lyric_task:
            self._lyric_task.cancel()
        self._lyric_task = asyncio.create_task(self._load_lyrics(self.mid))

    async def _load_lyrics(self, mid: str):
        """
        等 /api/lyrics 换成这一首，然后发给屏幕。

        单开一个任务是因为这里要等好几秒：切歌那一下客户端的歌词往往还没加载完，
        接口会先把上一首那份原样回给你。放在事件循环里干等会把 progress 和
        下一次切歌一起堵住——上一版「下一曲不刷新歌词」就是堵在这儿。
        """
        stale = self._lyric_fingerprint
        deadline = time.monotonic() + LYRIC_WAIT
        try:
            while self.mid == mid:
                payload = await self._api("/lyrics") or {}
                fingerprint = lyrics_fingerprint(payload)

                if fingerprint and fingerprint != stale:
                    await self._publish_lyrics(mid, payload, fingerprint)
                    return

                # 客户端说这首没歌词，那接口里剩的就是上一首的，别拿来用
                fresh = await self._api("/now-playing") or {}
                if fresh and str(fresh.get("id") or "") == mid and not fresh.get("lyricAvailable"):
                    self._lyric_fingerprint = ""
                    print("→ lyrics  这首没有歌词")
                    return

                if time.monotonic() >= deadline:
                    # 等超时。多半是循环播放同一首（指纹本来就一样），照发不误。
                    await self._publish_lyrics(mid, payload, fingerprint)
                    return

                await asyncio.sleep(LYRIC_RETRY)
        except asyncio.CancelledError:
            pass

    async def _publish_lyrics(self, mid: str, payload: dict, fingerprint: str):
        if self.mid != mid:  # 等的这会儿又换歌了，这份作废
            return
        lrc, origin = lyrics_to_lrc(payload)
        self.lrc = lrc
        self._lyric_fingerprint = fingerprint
        # 屏幕上没这首歌的时候先存着，等 _resume 占回屏幕时一起发
        if not self.retired:
            await self.link.lyrics(lrc)
        count = sum(1 for line in payload.get("lines") or [] if str(line.get("content") or "").strip() or line.get("words"))
        print(f"→ lyrics  {count} 行，{len(lrc)} 字节 —— {origin}" if count else f"→ lyrics  {origin}")

    # ── 状态 ────────────────────────────────────────────────────────────
    async def _apply(self, patch: dict, *, force: bool = False):
        """
        把一份快照（或事件补丁）落到 FancyDeck 上。

        WS 的 state/progress 事件只带进度，所以这里是往上一份快照打补丁：
        换歌看 id，播放/暂停看 state，其余就是报进度。
        """
        snapshot = {**self.snapshot, **{k: v for k, v in patch.items() if v is not None}}
        self.snapshot = snapshot
        self._last_signal = time.monotonic()

        mid = str(snapshot.get("id") or "")
        state = str(snapshot.get("state") or "")
        position = float(snapshot.get("position") or 0) / 1000 + self.offset
        playing = state == "playing"

        # 没曲目、停了、或者放完了都算停止：屏幕立刻退回普通 deck，不走暂停宽限
        if not mid or state in STOPPED_STATES or snapshot.get("isFinished"):
            await self._mark_stopped()
            return

        if mid != self.mid:
            await self._switch_song(snapshot, position, playing)
            return

        if playing:
            await self._resume(position, force=force)
        else:
            await self._pause(position, force=force)

    async def _resume(self, position: float, *, force: bool = False):
        if self.playing and not force and not self.retired:
            if await self.link.progress(position):
                print(f"→ progress {position:7.1f}s", end="\r", flush=True)
            return

        if self.retired and self.track:
            # 暂停太久让出去的屏幕，得重新占回来：曲目和歌词都再发一遍
            await self.link.play(self.track, position)
            # 歌词一并重发（这首没歌词就是空串），免得屏幕上留着别人的
            await self.link.lyrics(self.lrc)
            print(f"\n→ 重新开播  {self.track['title']}  {position:.1f}s")
        else:
            await self.link.progress(position, playing=True, force=True)
            print(f"\n→ 播放  {position:.1f}s")

        self.playing = True
        self.paused_at = None
        self.retired = False

    async def _pause(self, position: float, *, force: bool = False):
        """
        暂停只报一条就闭嘴。

        报的这条必须带 playing=false——不带的话服务端按「仍在播」处理，
        下一条心跳就把暂停顶回去了。之后不再发东西，屏幕停在这一刻，
        超过 idle_stop 秒由 _watchdog 收尾。
        """
        if self.retired:  # 屏幕已经让出去了，别再把卡片唤回来
            return
        if not self.playing and not force:
            return

        self.playing = False
        self.paused_at = time.monotonic()
        await self.link.progress(position, playing=False, force=True)
        print(f"\n→ 暂停  {position:.1f}s（{self.idle_stop:.0f}s 内不恢复就让出屏幕）")

    async def _mark_stopped(self):
        if not self.mid and not self.playing:
            return
        if self._lyric_task:
            self._lyric_task.cancel()
        # 早就让出屏幕了就不必再喊一遍停，清干净本地状态即可
        announce = not self.retired
        self.playing = False
        self.paused_at = None
        self.retired = False
        self.mid = ""
        self.track = {}
        self.lrc = ""
        self._lyric_fingerprint = ""
        self.snapshot = {}
        if announce:
            await self.link.stop()
            print("\n→ stop（播放器停了或者连不上了）")

    async def _recheck(self):
        """
        我们以为的状态和客户端的对不上时，去问一次 /api/status。

        两种情形都靠它兜底：暂停后还在推 progress（拿它当在播会把暂停顶回去），
        以及暂停后什么都不推（屏幕会一直空转）。本机接口很便宜，但也不必每条
        消息都问，隔 RECHECK_INTERVAL 秒问一次够了。
        """
        now = time.monotonic()
        if now - self._last_recheck < RECHECK_INTERVAL:
            return
        self._last_recheck = now
        status = await self._api("/status")
        if not status:
            return
        await self._apply({
            "state": status.get("state"),
            "position": status.get("position"),
            "duration": status.get("duration"),
            "isFinished": status.get("isFinished"),
        })

    async def _watchdog(self):
        """暂停太久就让出屏幕；以为在播却没动静就去核对一下状态。"""
        while True:
            await asyncio.sleep(0.5)
            if not self.mid:
                continue

            if self.playing:
                if time.monotonic() - self._last_signal > STALL_AFTER:
                    await self._recheck()
                continue

            if self.retired or self.paused_at is None:
                continue
            if time.monotonic() - self.paused_at < self.idle_stop:
                continue

            # 暂停够久了：把屏幕还给普通 deck，曲目和歌词留着，等它再播
            self.retired = True
            self.paused_at = None
            await self.link.stop()
            print(f"\n→ stop（暂停超过 {self.idle_stop:.0f}s，先把屏幕让出去）")

    # ── WebSocket ───────────────────────────────────────────────────────
    async def _on_event(self, kind: str, data: dict):
        if kind == "track":
            # 换歌以事件里的 id 为准：这一刻去问 now-playing，客户端有可能
            # 还没切过去，读回来的是上一首，那就整个换歌都被漏掉了。
            snapshot = {
                "id": data.get("id"),
                "name": data.get("name"),
                "artist": data.get("artist"),
                "cover": data.get("cover"),
                "duration": data.get("duration"),
                "album": "",
                "position": 0,
                "state": "playing",
                "isFinished": False,
            }
            # now-playing 只用来补 album 和进度，而且要确认它说的是同一首
            fresh = await self._api("/now-playing") or {}
            if str(fresh.get("id") or "") == str(data.get("id") or ""):
                snapshot.update({k: v for k, v in fresh.items() if v is not None})
            self.snapshot = {}  # 换歌是整份换掉，别让旧字段混进来
            await self._apply(snapshot)

        elif kind == "state":
            await self._apply({
                "state": data.get("state"),
                "position": data.get("position"),
                "duration": data.get("duration"),
            })

        elif kind == "progress":
            # 只更新进度，不动状态。有的版本暂停后照样推 progress，
            # 把它当成「在播」会把刚报上去的暂停顶回去。
            await self._apply({
                "position": data.get("position"),
                "duration": data.get("duration"),
            })
            if not self.playing:
                await self._recheck()

    async def _pump_ws(self, up):
        async for raw in up:
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            kind = message.get("kind")
            if kind == "event":
                await self._on_event(str(message.get("type") or ""), message.get("data") or {})
            elif kind == "hello":
                print(f"已连上 MeT-Music WebSocket（当前客户端 {message.get('clients')} 个）")
                # 事件是增量的，先取一次全量把当前在播的那首接上
                snapshot = await self._api("/now-playing")
                if snapshot:
                    await self._apply(snapshot, force=True)
            elif kind == "error":
                print(f"\n  ⚠ 命令 {message.get('op')} 失败：{message.get('error')}")
            # ack 不用管：命令的结果我们自己回读快照确认，不信回执

    async def _run_ws(self) -> bool:
        """跑一轮 WebSocket。返回是否真的连上过——没连上就说明那个开关没开。"""
        connected = False
        try:
            async with websockets.connect(self.ws_url) as up:
                connected = True
                self._ws_warned = False
                await self._pump_ws(up)
        except (OSError, WebSocketException) as error:
            if connected:
                print(f"\nWebSocket 断开（{error}）")
        return connected

    # ── 轮询兜底 ────────────────────────────────────────────────────────
    async def _poll(self, seconds: float | None):
        """轮询 /api/now-playing。seconds 是这一轮跑多久，None 表示一直跑。"""
        deadline = None if seconds is None else time.monotonic() + seconds
        while deadline is None or time.monotonic() < deadline:
            snapshot = await self._api("/now-playing")
            if snapshot is None:
                await self._mark_stopped()
            else:
                await self._apply(snapshot)
            await asyncio.sleep(POLL_INTERVAL)

    # ── 主循环 ──────────────────────────────────────────────────────────
    async def run(self, link: FancyDeckLink):
        self.link = link

        info = await self._api("/info")
        if info:
            print(f"已连上 {info.get('name')} {info.get('version')}  {self.base}")
        else:
            print(f"⚠ 连不上 {self.base}，先在 MeT-Music 里打开「设置 → 外部 API」；这边会一直重试")

        watchdog = asyncio.create_task(self._watchdog())
        try:
            while True:
                if self.transport != "poll":
                    connected = await self._run_ws()
                    if connected or self.transport == "ws":
                        if not connected and not self._ws_warned:
                            print(f"WebSocket 连不上 {self.ws_url}，3 秒一次地重试")
                            self._ws_warned = True
                        await self._mark_stopped()
                        await asyncio.sleep(3)
                        continue
                    if not self._ws_warned:
                        print(f"WebSocket 连不上（客户端里那个开关可能没开），"
                              f"改用轮询 /api/now-playing，之后每 {WS_RETRY:.0f} 秒回头试一次")
                        self._ws_warned = True

                await self._poll(None if self.transport == "poll" else WS_RETRY)
        finally:
            watchdog.cancel()
            if self._lyric_task:
                self._lyric_task.cancel()


# ════════════════════════════════════════════════════════════════════════════


async def run(url: str, source: MetMusicSource):
    link = FancyDeckLink(url)
    async with link:
        await source.run(link)


def main():
    parser = argparse.ArgumentParser(
        description="把 MeT-Music 正在放的歌上报给 FancyDeck 媒体插件（含 LRC 歌词）")
    parser.add_argument("--url", default=DEFAULT_URL, help=f"FancyDeck 的 WS 地址，默认 {DEFAULT_URL}")
    parser.add_argument("--met-host", default=MET_HOST, help=f"MeT-Music 所在主机，默认 {MET_HOST}")
    parser.add_argument("--met-port", type=int, default=MET_PORT, help=f"外部 API 端口，默认 {MET_PORT}")
    parser.add_argument("--transport", choices=["auto", "ws", "poll"], default="auto",
                        help="auto：先试 WebSocket，不通就轮询；ws / poll 则只用那一种")
    parser.add_argument("--offset", type=float, default=0.3,
                        help="歌词提前量（秒），抵消链路延迟，默认 0.3")
    parser.add_argument("--idle-stop", type=float, default=IDLE_STOP, metavar="秒",
                        help=f"暂停超过这么久就让出屏幕，回到普通 deck，默认 {IDLE_STOP:.0f}")

    args = parser.parse_args()
    source = MetMusicSource(args.met_host, args.met_port, offset=args.offset,
                            transport=args.transport, idle_stop=args.idle_stop)

    try:
        asyncio.run(run(args.url, source))
    except KeyboardInterrupt:
        print("\n中断，连接关闭 → 屏幕上应当停止播放")
    except OSError as error:
        sys.exit(f"连不上 {args.url}：{error}")


if __name__ == "__main__":
    main()
