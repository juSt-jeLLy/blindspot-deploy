import { Link, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";

const navLinks = [
  { to: "/trade", label: "Trade" },
  { to: "/pools", label: "Pools" },
  { to: "/orders", label: "My Orders" },
  { to: "/activity", label: "Activity" },
  { to: "/profile", label: "Profile" },
] as const;

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function getEthereum(): {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
} | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { ethereum?: unknown };
  if (!w.ethereum || typeof w.ethereum !== "object") return null;
  return w.ethereum as {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    on?: (event: string, handler: (...args: unknown[]) => void) => void;
    removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  };
}

async function switchToSepolia() {
  const eth = getEthereum();
  if (!eth) return;
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  const sepoliaRpc = env?.VITE_SEPOLIA_RPC_URL?.trim();
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e?.code === 4902) {
      if (!sepoliaRpc) throw new Error("VITE_SEPOLIA_RPC_URL is required");
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0xaa36a7",
          chainName: "Sepolia",
          nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: [sepoliaRpc],
          blockExplorerUrls: ["https://sepolia.etherscan.io"],
        }],
      });
    } else {
      throw err;
    }
  }
}

export function Layout() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [connected, setConnected] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("blindspot_wallet_connected") === "1";
  });

  async function connectWallet() {
    const eth = getEthereum();
    if (!eth) return;
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    const cid = (await eth.request({ method: "eth_chainId" })) as string;
    setWallet(accounts[0] ?? null);
    setChainId(cid);
    setConnected(true);
    if (typeof window !== "undefined") window.localStorage.setItem("blindspot_wallet_connected", "1");
  }

  async function refreshWallet() {
    const eth = getEthereum();
    if (!eth) return;
    const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
    const cid = (await eth.request({ method: "eth_chainId" })) as string;
    setWallet(accounts[0] ?? null);
    setChainId(cid);
  }

  async function switchAccount() {
    setMenuOpen(false);
    await connectWallet();
  }

  function disconnectWallet() {
    setMenuOpen(false);
    setWallet(null);
    setConnected(false);
    if (typeof window !== "undefined") window.localStorage.removeItem("blindspot_wallet_connected");
  }

  useEffect(() => {
    if (connected) refreshWallet();
    const eth = getEthereum();
    if (!eth?.on) return;

    const onAccountsChanged = (accounts: unknown) => {
      const next = Array.isArray(accounts) ? (accounts[0] as string | undefined) : undefined;
      setWallet(next ?? null);
    };
    const onChainChanged = (cid: unknown) => {
      if (typeof cid === "string") setChainId(cid);
    };

    eth.on("accountsChanged", onAccountsChanged);
    eth.on("chainChanged", onChainChanged);

    return () => {
      if (!eth.removeListener) return;
      eth.removeListener("accountsChanged", onAccountsChanged);
      eth.removeListener("chainChanged", onChainChanged);
    };
  }, [connected]);

  const onSepolia = chainId?.toLowerCase() === "0xaa36a7";

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 text-primary">
            <span className="text-lg leading-none">⬛</span>
            <span className="text-sm font-bold tracking-[0.2em]">BLINDSPOT</span>
          </Link>
          <nav className="hidden gap-1 md:flex">
            {navLinks.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="px-3 py-1.5 text-xs uppercase tracking-wider text-muted-foreground hover:text-primary"
                activeProps={{ className: "px-3 py-1.5 text-xs uppercase tracking-wider text-primary border-b border-primary" }}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="relative flex items-center gap-2 text-xs">
            {wallet ? (
              <>
                <span className="rounded border border-primary/40 bg-primary/10 px-2 py-1 text-primary">
                  <button onClick={() => setMenuOpen((v) => !v)} className="cursor-pointer">
                    {shortAddr(wallet)}
                  </button>
                </span>
                {menuOpen && (
                  <div className="absolute right-0 top-10 z-50 min-w-44 rounded border border-primary/30 bg-background p-1 shadow-xl">
                    <button onClick={switchAccount} className="block w-full rounded px-3 py-2 text-left text-xs uppercase tracking-wider text-foreground hover:bg-primary/10">Switch Account</button>
                    <button onClick={disconnectWallet} className="block w-full rounded px-3 py-2 text-left text-xs uppercase tracking-wider text-destructive hover:bg-destructive/10">Disconnect</button>
                  </div>
                )}
                <span className={`rounded border px-2 py-1 ${onSepolia ? "border-terminal-dim/40 text-terminal-dim" : "border-destructive/40 text-destructive"}`}>
                  {onSepolia ? "SEPOLIA" : "WRONG NET"}
                </span>
                {!onSepolia && (
                  <button onClick={switchToSepolia} className="rounded border border-primary/40 bg-primary/10 px-2 py-1 text-primary hover:bg-primary/20">SWITCH</button>
                )}
              </>
            ) : (
              <button onClick={connectWallet} className="rounded border border-primary bg-primary/10 px-3 py-1 text-primary hover:bg-primary/20">CONNECT WALLET</button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-border bg-card">
        <div className="border-b border-destructive/40 bg-destructive/10 py-2 text-center text-xs text-destructive">⚠ TESTNET ONLY — Sepolia. Tokens have no real value.</div>
      </footer>
    </div>
  );
}
