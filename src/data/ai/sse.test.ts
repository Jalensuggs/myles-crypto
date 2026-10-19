import { describe, expect, it } from "vitest";
import { SseParser } from "./sse";

describe("SseParser", () => {
  it("一次收到多条消息时全部交出", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"a":1}\n\ndata: {"a":2}\n\n')).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("消息被网络拆开时先攒着，收齐了再交出", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"con')).toEqual([]);
    expect(parser.push('tent":"你')).toEqual([]);
    expect(parser.push('好"}\n\n')).toEqual(['{"content":"你好"}']);
  });

  it("支持 \\r\\n 换行", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"a":1}\r\n\r\n')).toEqual(['{"a":1}']);
  });

  it("一条消息里的多行 data 会拼起来", () => {
    const parser = new SseParser();
    expect(parser.push("data: 第一行\ndata: 第二行\n\n")).toEqual(["第一行\n第二行"]);
  });

  it("忽略注释行和事件名这类非 data 的行", () => {
    const parser = new SseParser();
    expect(parser.push(": 心跳\n\nevent: ping\n\ndata: 正文\n\n")).toEqual(["正文"]);
  });

  it("结尾没有空行时由 flush 交出最后一条", () => {
    const parser = new SseParser();
    expect(parser.push("data: [DONE]")).toEqual([]);
    expect(parser.flush()).toEqual(["[DONE]"]);
    expect(parser.flush()).toEqual([]);
  });
});
