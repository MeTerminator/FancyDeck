import type { ClientMessage, ServerMessage } from './types'

/**
 * 与数据服务之间的长连接。自动重连、断线期间的发送排队都在这里，
 * 上层只看到「有没有连上」和「收到什么」。
 */

export type ConnectionStatus = 'connecting' | 'open' | 'closed'

export type Connection = {
  send: (message: ClientMessage) => void
  close: () => void
}

export function connect(options: {
  role: 'display' | 'console'
  onMessage: (message: ServerMessage) => void
  onStatus: (status: ConnectionStatus) => void
}): Connection {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
  let socket: WebSocket | null = null
  let retry = 0
  let closed = false
  let reconnectTimer: number | undefined
  let heartbeat: number | undefined
  const queue: ClientMessage[] = []

  const flush = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    while (queue.length > 0) socket.send(JSON.stringify(queue.shift()))
  }

  const open = () => {
    if (closed) return
    options.onStatus('connecting')
    socket = new WebSocket(url)

    socket.onopen = () => {
      retry = 0
      options.onStatus('open')
      socket?.send(JSON.stringify({ type: 'subscribe', role: options.role } satisfies ClientMessage))
      flush()
      // 有些反代 60s 不说话就掐，定期戳一下
      heartbeat = window.setInterval(() => socket?.send(JSON.stringify({ type: 'ping' })), 25_000)
    }

    socket.onmessage = (event) => {
      try {
        options.onMessage(JSON.parse(event.data as string) as ServerMessage)
      } catch {
        // 服务端发了看不懂的东西，忽略
      }
    }

    socket.onclose = () => {
      window.clearInterval(heartbeat)
      socket = null
      if (closed) return
      options.onStatus('closed')
      // 退避重连，但封顶 5s——桌面摆件断网后应该尽快自己回来
      const delay = Math.min(5000, 400 * 2 ** retry)
      retry += 1
      reconnectTimer = window.setTimeout(open, delay)
    }

    socket.onerror = () => socket?.close()
  }

  open()

  return {
    send(message) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
      else if (queue.length < 50) queue.push(message)
    },
    close() {
      closed = true
      window.clearTimeout(reconnectTimer)
      window.clearInterval(heartbeat)
      socket?.close()
    },
  }
}
