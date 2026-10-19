/**
 * 解析服务器推送流（SSE）。
 *
 * 模型是一个字一个字返回的，走的是 SSE：每条消息形如 `data: {...}`，消息之间空一行。
 * 网络分块和消息边界不是一回事——一次可能收到半条，也可能一次收到三条，
 * 所以这里先攒着，只把完整的消息交出去。
 */
export class SseParser {
  private buffer = "";

  /** 收到一段网络数据，返回其中已经完整的消息内容（data: 后面的部分） */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    let index = this.buffer.search(/\r?\n\r?\n/);
    while (index >= 0) {
      const block = this.buffer.slice(0, index);
      const match = /\r?\n\r?\n/.exec(this.buffer.slice(index))!;
      this.buffer = this.buffer.slice(index + match[0].length);
      const data = dataOf(block);
      if (data !== null) out.push(data);
      index = this.buffer.search(/\r?\n\r?\n/);
    }
    return out;
  }

  /** 流结束时调用，交出最后一条没有以空行结尾的消息 */
  flush(): string[] {
    const rest = this.buffer;
    this.buffer = "";
    const data = dataOf(rest);
    return data === null ? [] : [data];
  }
}

/** 一条消息里可能有多行 data:，按规范要拼起来 */
function dataOf(block: string): string | null {
  const parts: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    parts.push(line.slice(5).replace(/^ /, ""));
  }
  return parts.length === 0 ? null : parts.join("\n");
}
