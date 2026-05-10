import { TimeAgo } from "@/components/TimeAgo";
import { ALL_PAIR_KEYS } from "@/lib/contracts-config";
import { fetchActivity, type ChainActivity } from "@/lib/web3";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/activity")({ component: Activity });

function Activity() {
  const [events, setEvents] = useState<ChainActivity[]>([]);
  const [status, setStatus] = useState<string>("Loading activity...");

  async function load() {
    try {
      const list = await fetchActivity(ALL_PAIR_KEYS);
      setEvents(list);
      setStatus(list.length ? "" : "No matcher events yet.");
    } catch (e: any) {
      setStatus(`Could not load activity: ${e?.message ?? "unknown"}`);
      setEvents([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-sm uppercase tracking-widest text-muted-foreground">▸ Public Activity Feed</h1>
        <button onClick={load} className="rounded border border-border px-3 py-1 text-[10px] uppercase tracking-widest hover:border-primary hover:text-primary">Refresh</button>
      </div>

      {status && <div className="mb-3 rounded border border-border bg-card px-3 py-2 text-xs text-muted-foreground">{status}</div>}

      <div className="rounded border border-border bg-card font-mono text-xs">
        <div className="border-b border-border px-4 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">$ tail -f /var/log/blindspot/events</div>
        <ul className="max-h-[70vh] divide-y divide-border overflow-auto">
          {events.map((e) => (
            <li key={e.id} className="grid grid-cols-[110px_1fr_120px_90px] items-center gap-3 px-4 py-2 hover:bg-background/40">
              <EventTag type={e.type} />
              <span className="text-foreground">{e.pairLabel} · {e.txHash.slice(0, 12)}...</span>
              <span className="text-terminal-dim text-[10px]">block: {e.blockNumber}</span>
              <span className="text-right text-muted-foreground"><TimeAgo ts={e.timestamp} /></span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function EventTag({ type }: { type: ChainActivity["type"] }) {
  const map = {
    ORDER_SUBMIT_BUY: "border-primary/40 text-primary bg-primary/10",
    ORDER_SUBMIT_SELL: "border-destructive/40 text-destructive bg-destructive/10",
    ORDER_CANCELLED: "border-terminal-dim/40 text-terminal-dim bg-terminal-dim/10",
    MATCH_REQUESTED: "border-terminal-dim/40 text-terminal-dim bg-terminal-dim/10",
    MATCHED: "border-primary/40 text-primary bg-primary/10",
    NO_MATCH: "border-destructive/40 text-destructive bg-destructive/10",
    PARTIAL_FILL: "border-yellow-500/40 text-yellow-500 bg-yellow-500/10",
  } as const;
  return (
    <span className={`rounded border px-2 py-0.5 text-center text-[9px] uppercase tracking-widest ${map[type]}`}>
      {type}
    </span>
  );
}
