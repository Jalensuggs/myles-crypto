import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamConnection, type ConnectionStatus, type SocketLike } from "./stream-connection";

class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: { method: string; params: string[]; id: number }[] = [];
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }

  push(stream: string, data: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ stream, data }) });
  }

  raw(text: string): void {
    this.onmessage?.({ data: text });
  }
}

const latest = () => FakeSocket.instances[FakeSocket.instances.length - 1]!;

function setup() {
  const statuses: ConnectionStatus[] = [];
  const conn = new StreamConnection({
    url: "wss://test/stream",
    createSocket: (url) => new FakeSocket(url),
    random: () => 0.5,
    sendIntervalMs: 250,
    staleAfterMs: 30_000,
    idleCloseMs: 3_000,
    onStatus: (s) => statuses.push(s),
  });
  return { conn, statuses };
}

const subscribed = (s: FakeSocket) => s.sent.filter((m) => m.method === "SUBSCRIBE").flatMap((m) => m.params);
const unsubscribed = (s: FakeSocket) => s.sent.filter((m) => m.method === "UNSUBSCRIBE").flatMap((m) => m.params);

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StreamConnection", () => {
  it("没有订阅时不建立连接", () => {
    const { conn } = setup();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(conn.status).toBe("idle");
  });

  it("第一次订阅时连接，打开后一次性发送全部订阅", () => {
    const { conn, statuses } = setup();
    conn.subscribe("a", () => {});
    conn.subscribe("b", () => {});
    expect(FakeSocket.instances).toHaveLength(1);
    expect(conn.status).toBe("connecting");

    latest().open();
    vi.advanceTimersByTime(300);
    expect(latest().sent).toHaveLength(1);
    expect(subscribed(latest()).sort()).toEqual(["a", "b"]);
    expect(statuses).toEqual(["connecting", "open"]);
  });

  it("同一个流的多个订阅者只向服务端订阅一次，并且都能收到数据", () => {
    const { conn } = setup();
    const a = vi.fn();
    const b = vi.fn();
    conn.subscribe("s", a);
    latest().open();
    vi.advanceTimersByTime(300);
    conn.subscribe("s", b);
    vi.advanceTimersByTime(300);

    expect(subscribed(latest())).toEqual(["s"]);
    latest().push("s", { v: 1 });
    expect(a).toHaveBeenCalledWith({ v: 1 });
    expect(b).toHaveBeenCalledWith({ v: 1 });
  });

  it("最后一个订阅者离开才退订", () => {
    const { conn } = setup();
    conn.subscribe("keep", () => {});
    const off1 = conn.subscribe("s", () => {});
    const off2 = conn.subscribe("s", () => {});
    latest().open();
    vi.advanceTimersByTime(300);

    off1();
    vi.advanceTimersByTime(300);
    expect(unsubscribed(latest())).toEqual([]);

    off2();
    vi.advanceTimersByTime(300);
    expect(unsubscribed(latest())).toEqual(["s"]);

    off2();
    vi.advanceTimersByTime(300);
    expect(unsubscribed(latest())).toEqual(["s"]);
  });

  it("刚退订又马上重新订阅时两条消息相互抵消", () => {
    const { conn } = setup();
    conn.subscribe("keep", () => {});
    const off = conn.subscribe("s", () => {});
    latest().open();
    vi.advanceTimersByTime(300);
    const before = latest().sent.length;

    off();
    conn.subscribe("s", () => {});
    vi.advanceTimersByTime(600);
    expect(latest().sent.length).toBe(before);
  });

  it("订阅消息限速发送，每个间隔最多一条", () => {
    const { conn } = setup();
    conn.subscribe("keep", () => {});
    latest().open();
    vi.advanceTimersByTime(300);
    const base = latest().sent.length;

    const off = conn.subscribe("x", () => {});
    conn.subscribe("y", () => {});
    vi.advanceTimersByTime(250);
    off();
    conn.subscribe("z", () => {});
    vi.advanceTimersByTime(100);
    expect(latest().sent.length - base).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(subscribed(latest())).toEqual(expect.arrayContaining(["x", "y", "z"]));
    expect(unsubscribed(latest())).toEqual(["x"]);
  });

  it("断线后按退避时间重连，并且只重订一次，不重复", () => {
    const { conn, statuses } = setup();
    const onReconnect = vi.fn();
    conn.onReconnect(onReconnect);
    conn.subscribe("a", () => {});
    conn.subscribe("b", () => {});
    latest().open();
    vi.advanceTimersByTime(300);
    expect(onReconnect).not.toHaveBeenCalled();

    latest().drop();
    expect(conn.status).toBe("reconnecting");
    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);

    latest().open();
    vi.advanceTimersByTime(2000);
    expect(latest().sent).toHaveLength(1);
    expect(subscribed(latest()).sort()).toEqual(["a", "b"]);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["connecting", "open", "reconnecting", "open"]);
  });

  it("连续失败时等待时间逐步变长：1s、2s、4s", () => {
    const { conn } = setup();
    conn.subscribe("a", () => {});
    latest().drop();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(2);
    latest().drop();
    vi.advanceTimersByTime(1999);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(3);
    latest().drop();
    vi.advanceTimersByTime(3999);
    expect(FakeSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it("重连成功后退避次数清零", () => {
    const { conn } = setup();
    conn.subscribe("a", () => {});
    latest().drop();
    vi.advanceTimersByTime(1000);
    latest().drop();
    vi.advanceTimersByTime(2000);
    latest().open();
    latest().drop();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it("断线期间新增的订阅会在重连后一起发出", () => {
    const { conn } = setup();
    conn.subscribe("a", () => {});
    latest().open();
    vi.advanceTimersByTime(300);
    latest().drop();
    conn.subscribe("b", () => {});
    vi.advanceTimersByTime(1000);
    latest().open();
    vi.advanceTimersByTime(300);
    expect(subscribed(latest()).sort()).toEqual(["a", "b"]);
  });

  it("retryNow 跳过等待立即重连", () => {
    const { conn } = setup();
    conn.subscribe("a", () => {});
    latest().drop();
    conn.retryNow();
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("有订阅但长时间没有消息时视为假死并重连", () => {
    const { conn } = setup();
    conn.subscribe("a", () => {});
    latest().open();
    const first = latest();
    vi.advanceTimersByTime(20_000);
    first.push("a", {});
    vi.advanceTimersByTime(20_000);
    expect(FakeSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(21_000);
    expect(first.closed).toBe(true);
    expect(conn.status).toBe("reconnecting");
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("无法识别的消息和出错的处理函数都不会影响连接", () => {
    const { conn } = setup();
    const good = vi.fn();
    conn.subscribe("s", () => {
      throw new Error("boom");
    });
    conn.subscribe("s", good);
    latest().open();

    latest().raw("not json");
    latest().raw(JSON.stringify({ result: null, id: 1 }));
    latest().raw(JSON.stringify({ stream: 123 }));
    latest().push("unknown-stream", {});
    latest().push("s", { ok: true });

    expect(good).toHaveBeenCalledTimes(1);
    expect(conn.status).toBe("open");
  });

  it("全部退订后过一会儿关闭连接，期间重新订阅则保留", () => {
    const { conn } = setup();
    const off = conn.subscribe("a", () => {});
    latest().open();
    vi.advanceTimersByTime(300);

    off();
    vi.advanceTimersByTime(1000);
    const again = conn.subscribe("a", () => {});
    vi.advanceTimersByTime(5000);
    expect(latest().closed).toBe(false);
    expect(conn.status).toBe("open");

    again();
    vi.advanceTimersByTime(3000);
    expect(latest().closed).toBe(true);
    expect(conn.status).toBe("idle");
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
