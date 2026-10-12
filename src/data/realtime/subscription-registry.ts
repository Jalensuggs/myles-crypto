/**
 * 按流名做引用计数。第一个订阅者加入时才需要向服务端订阅，
 * 最后一个离开时才需要退订。
 */
export class SubscriptionRegistry<Handler> {
  private readonly map = new Map<string, Set<Handler>>();

  /** 返回 true 表示这是该流的第一个订阅者 */
  add(stream: string, handler: Handler): boolean {
    let set = this.map.get(stream);
    const first = !set;
    if (!set) {
      set = new Set();
      this.map.set(stream, set);
    }
    set.add(handler);
    return first;
  }

  /** 返回 true 表示该流已经没有订阅者 */
  remove(stream: string, handler: Handler): boolean {
    const set = this.map.get(stream);
    if (!set || !set.delete(handler)) return false;
    if (set.size > 0) return false;
    this.map.delete(stream);
    return true;
  }

  handlers(stream: string): readonly Handler[] {
    const set = this.map.get(stream);
    return set ? [...set] : [];
  }

  has(stream: string): boolean {
    return this.map.has(stream);
  }

  activeStreams(): string[] {
    return [...this.map.keys()];
  }

  get size(): number {
    return this.map.size;
  }
}
