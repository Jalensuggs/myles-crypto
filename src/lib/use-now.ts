import { useEffect, useState } from "react";

/** 每隔 intervalMs 返回一次当前时间，用于倒计时和相对时间 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
