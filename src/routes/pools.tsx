import { createFileRoute, Link } from "@tanstack/react-router";
import { LIVE_PAIRS } from "@/lib/live-pairs";

export const Route = createFileRoute("/pools")({
  head: () => ({ meta: [{ title: "Pools — Blindspot" }, { name: "description", content: "Browse all registered FHE trading pairs on Blindspot." }] }),
  component: Pools,
});

function Pools() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-sm uppercase tracking-widest text-muted-foreground">▸ Registered Pairs</h1>
          <p className="mt-1 text-xs text-muted-foreground/70">{LIVE_PAIRS.length} active markets · live sepolia addresses</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {LIVE_PAIRS.map((p) => (
          <div key={p.key} className="rounded border border-border bg-card p-5 hover:border-primary/50">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-lg text-foreground">
                  {p.tokenA}<span className="text-muted-foreground">/</span>{p.tokenB}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">pair · {p.key}</div>
              </div>
              <span className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground">FHE</span>
            </div>

            <div className="mt-4 space-y-1 text-[11px] text-muted-foreground">
              <div className="flex justify-between"><span>Escrow</span><span className="font-mono text-foreground">{p.escrow.slice(0, 8)}...{p.escrow.slice(-6)}</span></div>
              <div className="flex justify-between"><span>Matcher</span><span className="font-mono text-foreground">{p.matcher.slice(0, 8)}...{p.matcher.slice(-6)}</span></div>
              <div className="flex justify-between"><span>Settlement</span><span className="font-mono text-foreground">{p.settlement.slice(0, 8)}...{p.settlement.slice(-6)}</span></div>
            </div>

            <Link
              to="/trade"
              search={{ pair: p.key }}
              className="mt-5 block rounded border border-border py-2 text-center text-[11px] uppercase tracking-widest text-foreground hover:border-primary hover:text-primary"
            >
              ▸ Trade {p.tokenA}/{p.tokenB}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
