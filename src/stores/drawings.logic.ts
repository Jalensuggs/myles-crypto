import { z } from "zod";
import { DRAWING_TYPES, MAX_TEXT_LENGTH, POINTS_REQUIRED, type DrawingObject } from "@/types/drawing";

export const drawingSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(DRAWING_TYPES),
    points: z
      .array(z.object({ time: z.number().finite(), price: z.number().finite() }))
      .min(1)
      .max(3),
    locked: z.boolean(),
    hidden: z.boolean(),
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
    width: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    dash: z.boolean().optional(),
    text: z.string().max(MAX_TEXT_LENGTH).optional(),
  })
  // 点数和图形类型对不上的记录画不出来，直接判为无效
  .refine((d) => d.points.length === POINTS_REQUIRED[d.type], "点数与图形类型不符");

export const drawingsRecordSchema = z.object({
  byMarket: z.record(z.string(), z.array(drawingSchema)),
});

export type DrawingsByMarket = Record<string, DrawingObject[]>;

export const MAX_HISTORY = 50;

export interface DrawingHistory {
  byMarket: DrawingsByMarket;
  past: DrawingsByMarket[];
  future: DrawingsByMarket[];
}

/** 记录一次可撤销的修改 */
export function commit(h: DrawingHistory, next: DrawingsByMarket): DrawingHistory {
  if (next === h.byMarket) return h;
  return { byMarket: next, past: [...h.past, h.byMarket].slice(-MAX_HISTORY), future: [] };
}

export function undo(h: DrawingHistory): DrawingHistory {
  const previous = h.past[h.past.length - 1];
  if (!previous) return h;
  return { byMarket: previous, past: h.past.slice(0, -1), future: [h.byMarket, ...h.future] };
}

export function redo(h: DrawingHistory): DrawingHistory {
  const next = h.future[0];
  if (!next) return h;
  return { byMarket: next, past: [...h.past, h.byMarket], future: h.future.slice(1) };
}

export function withAdded(by: DrawingsByMarket, key: string, drawing: DrawingObject): DrawingsByMarket {
  return { ...by, [key]: [...(by[key] ?? []), drawing] };
}

export function withUpdated(
  by: DrawingsByMarket,
  key: string,
  id: string,
  patch: Partial<Omit<DrawingObject, "id" | "type">>,
): DrawingsByMarket {
  const list = by[key];
  if (!list || !list.some((d) => d.id === id)) return by;
  return { ...by, [key]: list.map((d) => (d.id === id ? { ...d, ...patch } : d)) };
}

export function withRemoved(by: DrawingsByMarket, key: string, id: string): DrawingsByMarket {
  const list = by[key];
  if (!list || !list.some((d) => d.id === id)) return by;
  return { ...by, [key]: list.filter((d) => d.id !== id) };
}

export function withCleared(by: DrawingsByMarket, key: string): DrawingsByMarket {
  if (!by[key] || by[key].length === 0) return by;
  return { ...by, [key]: [] };
}

export function countAll(by: DrawingsByMarket): number {
  let total = 0;
  for (const list of Object.values(by)) total += list.length;
  return total;
}
