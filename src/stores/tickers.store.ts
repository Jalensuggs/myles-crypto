import { create } from "zustand";
import type { Candle, Derivatives, Ticker } from "@/types/market";

interface TickersState {
  /** 以 marketKey 为键 */
  tickers: Record<string, Ticker>;
  /** 以合约标的名为键 */
  derivatives: Record<string, Derivatives>;
  openInterest: Record<string, number>;
  /** 以 marketKey 为键的价格小数位数，由图表加载 K 线后写入 */
  precision: Record<string, number>;
  /** 以合约标的名为键：美股最近若干个交易日的官方日线，用来算相对收盘价的涨跌幅 */
  stockDays: Record<string, Candle[]>;
  setTicker: (key: string, ticker: Ticker) => void;
  setDerivatives: (symbol: string, data: Derivatives) => void;
  setOpenInterest: (symbol: string, value: number) => void;
  setPrecision: (key: string, precision: number) => void;
  setStockDays: (symbol: string, days: Candle[]) => void;
}

export const useTickersStore = create<TickersState>((set) => ({
  tickers: {},
  derivatives: {},
  openInterest: {},
  precision: {},
  stockDays: {},
  setStockDays: (symbol, days) => set((s) => ({ stockDays: { ...s.stockDays, [symbol]: days } })),
  setTicker: (key, ticker) => set((s) => ({ tickers: { ...s.tickers, [key]: ticker } })),
  setDerivatives: (symbol, data) => set((s) => ({ derivatives: { ...s.derivatives, [symbol]: data } })),
  setOpenInterest: (symbol, value) => set((s) => ({ openInterest: { ...s.openInterest, [symbol]: value } })),
  setPrecision: (key, precision) =>
    set((s) => (s.precision[key] === precision ? s : { precision: { ...s.precision, [key]: precision } })),
}));
