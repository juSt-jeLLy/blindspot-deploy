import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Blindspot — Encrypted Institutional Dark Pool DEX" },
      { name: "description", content: "FHE-powered dark pool DEX on Sepolia. Trade institutional size with fully encrypted orders." },
    ],
  }),
  component: Index,
});

function useCounter(target: number, dur = 1500) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      setV(Math.floor(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return v;
}

function Index() {
  const pairs = useCounter(42);
  const matches = useCounter(317);

  return (
    <div className="relative">
      <section className="mx-auto max-w-5xl px-4 pt-24 pb-20 text-center">
        <div className="mb-4 inline-block rounded border border-primary/40 bg-primary/10 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-primary">
          ▲ Live on Sepolia · FHE Matching Engine
        </div>
        <h1 className="text-4xl font-bold leading-tight text-foreground md:text-6xl">
          <span className="text-primary">/</span>institutional flow,<br />
          <span className="terminal-cursor">fully encrypted</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-sm text-muted-foreground md:text-base">
          Blindspot is an FHE-secured dark pool DEX. Order size and price stay encrypted on-chain
          until matched. Zero leakage. Zero front-running.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <button className="rounded border border-primary bg-primary/10 px-6 py-3 text-sm uppercase tracking-wider text-primary hover:bg-primary/20">
            ▸ Connect Wallet
          </button>
          <Link
            to="/trade"
            className="rounded border border-border px-6 py-3 text-sm uppercase tracking-wider text-foreground hover:border-primary hover:text-primary"
          >
            Enter Terminal →
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl grid-cols-1 gap-4 px-4 pb-24 md:grid-cols-3">
        <Stat label="Total Pairs" value={pairs.toString().padStart(3, "0")} />
        <Stat label="Matches Today" value={matches.toString().padStart(4, "0")} />
        <Stat label="24h Volume" value="[ENCRYPTED]" pulse />
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-24">
        <div className="rounded border border-border bg-card p-6 font-mono text-xs text-muted-foreground">
          <div className="text-terminal-dim">$ blindspot --status</div>
          <div className="mt-2"><span className="text-primary">●</span> matching engine: <span className="text-primary">ONLINE</span></div>
          <div><span className="text-primary">●</span> fhe oracle: <span className="text-primary">SYNCED</span></div>
          <div><span className="text-primary">●</span> network: <span className="text-foreground">sepolia (chainid 11155111)</span></div>
          <div className="mt-2 text-foreground">▸ ready to encrypt _</div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, pulse }: { label: string; value: string; pulse?: boolean }) {
  return (
    <div className="rounded border border-border bg-card p-6">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-3 text-3xl text-primary ${pulse ? "animate-pulse" : ""}`}>{value}</div>
    </div>
  );
}
