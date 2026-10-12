import { memo } from "react";
import { baseAsset } from "@/types/market";

const PALETTE = ["#f7931a", "#627eea", "#14b8a6", "#f0b90b", "#8b5cf6", "#c2a633", "#ef4444", "#3b82f6", "#ec4899", "#22c55e"];

function colorOf(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** 按币种首字母生成的本地图标，不依赖任何外部图片 */
export const CoinIcon = memo(function CoinIcon({ symbol, size = 16 }: { symbol: string; size?: number }) {
  const base = baseAsset(symbol).replace(/^\d+/, "") || symbol;
  return (
    <span
      className="coin"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.56), background: colorOf(base) }}
    >
      {base.charAt(0)}
    </span>
  );
});
