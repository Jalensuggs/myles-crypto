/**
 * 页面和服务端之间的约定。两边都引用这一份，改了不会对不上。
 * 页面只发"行情快照"，提示词由服务端按快照生成，所以这个接口只能用来分析行情。
 */
import { z } from "zod";
import { snapshotSchema } from "./snapshot";

/** 页面请求自己服务端的地址 */
export const AI_PATH = "/api/ai";

/** 模型名可能带厂商前缀，例如 openai/gpt-oss-120b */
export const MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/;

export const analyzeRequestSchema = z.object({
  snapshot: snapshotSchema,
  /** 用哪个模型，省略时用服务端配置的默认模型 */
  model: z.string().max(64).regex(MODEL_PATTERN).optional(),
  /** 思考档位。档位越高越慢，默认用低档，先出结果 */
  effort: z.enum(["low", "high"]).optional(),
});

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

/** 网关没有配置模型时用这个 */
export const DEFAULT_MODEL = "openai/gpt-oss-120b";
/**
 * 一次分析的输出上限。
 * 注意这个额度是"思考 + 正文"一起算的：会推理的模型光想就要几千，
 * 给少了就会出现"想完了但一个字没写"（曾经在这上面栽过）。
 * 所以这里留得比正文实际需要的宽得多。
 */
export const MAX_OUTPUT_TOKENS = 8000;

/** 出错时服务端在流里发的内容，页面据此显示错误 */
export interface StreamError {
  mc_error: string;
}

export function isStreamError(value: unknown): value is StreamError {
  return typeof value === "object" && value !== null && typeof (value as StreamError).mc_error === "string";
}
