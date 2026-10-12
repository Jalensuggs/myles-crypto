import { Trash2 } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { formatRelativeTime } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { useFeedStore } from "@/stores/feed.store";
import { selectActiveTab, useWorkspaceStore } from "@/stores/workspace.store";
import { displayName, type MarketEvent } from "@/types/market";

export function EventFeed() {
  const events = useFeedStore((s) => s.events);
  const clear = useFeedStore((s) => s.clear);
  const activeName = displayName(useWorkspaceStore(selectActiveTab).market);
  const [onlyActive, setOnlyActive] = useState(false);
  const now = useNow(10_000);

  const visible = useMemo(
    () => (onlyActive ? events.filter((e) => e.symbol === activeName) : events),
    [events, onlyActive, activeName],
  );

  const open = (event: MarketEvent) => {
    const ws = useWorkspaceStore.getState();
    const tab = ws.tabs.find((t) => displayName(t.market) === event.symbol);
    if (tab) ws.activate(tab.id);
  };

  return (
    <section className="feed" aria-label="市场异动" data-testid="event-feed">
      <div className="feed__head">
        <button type="button" className="chip" aria-pressed={!onlyActive} onClick={() => setOnlyActive(false)}>
          全部
        </button>
        <button type="button" className="chip" aria-pressed={onlyActive} onClick={() => setOnlyActive(true)}>
          当前标的
        </button>
        <span className="feed__count">{visible.length} 条</span>
        <div className="feed__actions">
          <button
            type="button"
            className="tbtn tbtn--icon"
            aria-label="清空异动记录"
            title="清空异动记录"
            disabled={events.length === 0}
            onClick={clear}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="feed__empty">
          暂时没有异动。
          <br />
          已打开的标的出现大额爆仓、急涨急跌、
          <br />
          资金费率异常或突破 24 小时区间时，会显示在这里。
        </div>
      ) : (
        <ul className="feed__list">
          {visible.map((event) => (
            <EventItem key={event.id} event={event} now={now} onOpen={open} />
          ))}
        </ul>
      )}
    </section>
  );
}

const EventItem = memo(function EventItem({
  event,
  now,
  onOpen,
}: {
  event: MarketEvent;
  now: number;
  onOpen: (event: MarketEvent) => void;
}) {
  return (
    <li>
      <button type="button" className="event" data-tone={event.tone} onClick={() => onOpen(event)}>
        <span className="event__bar" />
        <span>
          <span className="event__top">
            <span className="event__symbol">{event.symbol}</span>
            <span className="event__time">{formatRelativeTime(event.createdAt, now)}</span>
          </span>
          <span className="event__title" style={{ display: "block" }}>
            {event.title}
          </span>
          {event.detail && (
            <span className="event__detail" style={{ display: "block" }}>
              {event.detail}
            </span>
          )}
        </span>
      </button>
    </li>
  );
});
