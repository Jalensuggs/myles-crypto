import { create } from "zustand";
import type { ConnectionStatus } from "@/data/realtime/stream-connection";
import type { MarketKind } from "@/types/market";

interface ConnectionState {
  status: Record<MarketKind, ConnectionStatus>;
  setStatus: (market: MarketKind, status: ConnectionStatus) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: { perp: "idle", spot: "idle" },
  setStatus: (market, status) =>
    set((s) => (s.status[market] === status ? s : { status: { ...s.status, [market]: status } })),
}));

export type OverallStatus = "open" | "connecting" | "reconnecting" | "idle";

export function overallStatus(status: Record<MarketKind, ConnectionStatus>): OverallStatus {
  const values = [status.perp, status.spot].filter((s) => s !== "idle");
  if (values.length === 0) return "idle";
  if (values.includes("reconnecting")) return "reconnecting";
  if (values.includes("connecting")) return "connecting";
  return "open";
}
