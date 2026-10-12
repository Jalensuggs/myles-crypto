import { wsEnvelopeSchema } from "@/data/binance/schemas";
import { backoffDelay } from "./backoff";
import { SubscriptionRegistry } from "./subscription-registry";

export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting";
export type StreamHandler = (data: unknown) => void;

export interface SocketLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface StreamConnectionOptions {
  url: string;
  createSocket?: (url: string) => SocketLike;
  random?: () => number;
  /** 订阅与退订消息的最小发送间隔 */
  sendIntervalMs?: number;
  /** 有订阅但超过这么久没有任何消息就视为假死 */
  staleAfterMs?: number;
  /** 没有订阅者之后保留连接的时间 */
  idleCloseMs?: number;
  onStatus?: (status: ConnectionStatus) => void;
}

const OPEN = 1;
const MAX_PARAMS_PER_MESSAGE = 100;

/**
 * 一条 Binance 组合流连接。负责引用计数订阅、限速发送、断线重连和假死检测。
 * 状态：idle → connecting → open →（断开）reconnecting → connecting → open
 */
export class StreamConnection {
  private readonly registry = new SubscriptionRegistry<StreamHandler>();
  private readonly reconnectListeners = new Set<() => void>();
  private readonly opts: Required<Omit<StreamConnectionOptions, "onStatus">> & Pick<StreamConnectionOptions, "onStatus">;

  private socket: SocketLike | null = null;
  private statusValue: ConnectionStatus = "idle";
  private attempt = 0;
  private everOpened = false;
  private nextId = 1;
  private lastMessageAt = 0;

  private readonly pendingSub = new Set<string>();
  private readonly pendingUnsub = new Set<string>();
  private outbox: string[] = [];

  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  constructor(options: StreamConnectionOptions) {
    this.opts = {
      createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      random: Math.random,
      sendIntervalMs: 250,
      staleAfterMs: 30_000,
      idleCloseMs: 3_000,
      ...options,
    };
  }

  get status(): ConnectionStatus {
    return this.statusValue;
  }

  activeStreams(): string[] {
    return this.registry.activeStreams();
  }

  subscribe(stream: string, handler: StreamHandler): () => void {
    const first = this.registry.add(stream, handler);
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (first) {
      if (this.isOpen()) {
        // 同一流刚排队退订又被重新订阅时，两条消息相互抵消
        if (!this.pendingUnsub.delete(stream)) this.pendingSub.add(stream);
        this.scheduleFlush();
      } else if (this.statusValue === "idle") {
        this.connect();
      }
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const last = this.registry.remove(stream, handler);
      if (!last) return;
      if (this.isOpen()) {
        if (!this.pendingSub.delete(stream)) this.pendingUnsub.add(stream);
        this.scheduleFlush();
      }
      if (this.registry.size === 0) this.scheduleIdleClose();
    };
  }

  /** 断线重连成功后触发，首次连接不触发 */
  onReconnect(listener: () => void): () => void {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  /** 网络恢复等场景下跳过等待，立即重连 */
  retryNow(): void {
    if (this.statusValue !== "reconnecting" || !this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connect();
  }

  dispose(): void {
    this.clearTimers();
    this.detachSocket(true);
    this.setStatus("idle");
  }

  private isOpen(): boolean {
    return this.statusValue === "open" && this.socket?.readyState === OPEN;
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.statusValue === next) return;
    this.statusValue = next;
    this.opts.onStatus?.(next);
  }

  private connect(): void {
    this.detachSocket(true);
    this.setStatus(this.everOpened || this.attempt > 0 ? "reconnecting" : "connecting");

    let socket: SocketLike;
    try {
      socket = this.opts.createSocket(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      const isReconnect = this.everOpened;
      this.everOpened = true;
      this.attempt = 0;
      this.lastMessageAt = Date.now();
      this.pendingSub.clear();
      this.pendingUnsub.clear();
      this.outbox = [];
      this.setStatus("open");
      // 重连后一次性重订全部活跃流，不会重复
      this.enqueue("SUBSCRIBE", this.registry.activeStreams());
      this.startWatchdog();
      if (isReconnect) {
        for (const listener of [...this.reconnectListeners]) {
          try {
            listener();
          } catch {
            // 单个监听者出错不影响其他监听者
          }
        }
      }
    };

    socket.onmessage = (ev) => {
      if (this.socket !== socket) return;
      this.lastMessageAt = Date.now();
      this.dispatch(ev.data);
    };

    socket.onerror = () => {
      // 随后一定会触发 onclose，在那里统一处理
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopWatchdog();
      if (this.registry.size === 0) {
        this.setStatus("idle");
        return;
      }
      this.scheduleReconnect();
    };
  }

  private dispatch(raw: unknown): void {
    if (typeof raw !== "string") return;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    const envelope = wsEnvelopeSchema.safeParse(json);
    // 订阅确认等其他消息直接丢弃
    if (!envelope.success) return;
    for (const handler of this.registry.handlers(envelope.data.stream)) {
      try {
        handler(envelope.data.data);
      } catch {
        // 处理函数出错不能拖垮连接
      }
    }
  }

  private scheduleReconnect(): void {
    this.setStatus("reconnecting");
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = backoffDelay(this.attempt, this.opts.random);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.registry.size === 0) {
        this.setStatus("idle");
        return;
      }
      this.connect();
    }, delay);
  }

  private scheduleIdleClose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.registry.size > 0) return;
      this.clearTimers();
      this.detachSocket(true);
      this.attempt = 0;
      this.everOpened = false;
      this.setStatus("idle");
    }, this.opts.idleCloseMs);
  }

  private enqueue(method: "SUBSCRIBE" | "UNSUBSCRIBE", params: string[]): void {
    for (let i = 0; i < params.length; i += MAX_PARAMS_PER_MESSAGE) {
      this.outbox.push(
        JSON.stringify({ method, params: params.slice(i, i + MAX_PARAMS_PER_MESSAGE), id: this.nextId++ }),
      );
    }
    if (this.outbox.length > 0) this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.sendTimer) return;
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      this.flush();
    }, this.opts.sendIntervalMs);
  }

  private flush(): void {
    if (!this.isOpen() || !this.socket) return;
    if (this.pendingUnsub.size > 0) {
      const params = [...this.pendingUnsub];
      this.pendingUnsub.clear();
      this.enqueue("UNSUBSCRIBE", params);
    }
    if (this.pendingSub.size > 0) {
      const params = [...this.pendingSub];
      this.pendingSub.clear();
      this.enqueue("SUBSCRIBE", params);
    }
    const next = this.outbox.shift();
    if (next !== undefined) {
      try {
        this.socket.send(next);
      } catch {
        // 发送失败说明连接已坏，交给 onclose 处理
      }
    }
    if (this.outbox.length > 0) this.scheduleFlush();
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    const every = Math.max(1000, Math.floor(this.opts.staleAfterMs / 3));
    this.watchdog = setInterval(() => {
      if (!this.isOpen() || this.registry.size === 0) return;
      if (Date.now() - this.lastMessageAt < this.opts.staleAfterMs) return;
      // 假死：主动断开，走正常的重连流程
      this.detachSocket(true);
      this.stopWatchdog();
      this.scheduleReconnect();
    }, every);
  }

  private stopWatchdog(): void {
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
  }

  private detachSocket(close: boolean): void {
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (close) {
      try {
        socket.close();
      } catch {
        // 忽略
      }
    }
  }

  private clearTimers(): void {
    if (this.sendTimer) clearTimeout(this.sendTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.sendTimer = null;
    this.reconnectTimer = null;
    this.idleTimer = null;
    this.stopWatchdog();
  }
}
