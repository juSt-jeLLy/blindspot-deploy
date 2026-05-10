import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  getBrowserProvider,
  getConfidentialTokenStatus,
  getConfidentialTokens,
  unwrapConfidentialToUnderlying,
} from "@/lib/web3";
import { decryptHandleForUser } from "@/lib/fhe";
import { formatUnits } from "ethers";

type TokenState = {
  cToken: string;
  cSymbol: string;
  underlying: string;
  underlyingSymbol: string;
  underlyingBalance: string;
  encryptedHandle: string;
  decryptedBalance?: string;
};

export const Route = createFileRoute("/profile")({ component: ProfilePage });

function isZeroHandle(handle: string) {
  return /^0x0{64}$/i.test(handle);
}

function shortAddr(a: string) {
  return `${a.slice(0, 8)}...${a.slice(-6)}`;
}

function ProfilePage() {
  const [wallet, setWallet] = useState<string>("");
  const [tokens, setTokens] = useState<TokenState[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [unwrapAmount, setUnwrapAmount] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const current = useMemo(
    () => tokens.find((t) => t.cToken.toLowerCase() === selected.toLowerCase()) ?? null,
    [tokens, selected],
  );

  async function load() {
    setLoading(true);
    setGlobalError(null);
    setStatus(null);
    try {
      const provider = getBrowserProvider();
      const signer = await provider.getSigner();
      const owner = await signer.getAddress();
      setWallet(owner);

      const list = getConfidentialTokens();
      const next: TokenState[] = [];
      for (const token of list) {
        const s = await getConfidentialTokenStatus({
          cToken: token.address,
          owner,
          signer,
        });
        next.push({
          ...s,
          decryptedBalance: isZeroHandle(s.encryptedHandle) ? "0" : undefined,
        });
      }

      setTokens(next);
      if (!selected && next.length > 0) {
        setSelected(next[0].cToken);
      } else if (selected && !next.some((t) => t.cToken.toLowerCase() === selected.toLowerCase())) {
        setSelected(next[0]?.cToken ?? "");
      }
    } catch (e: any) {
      setGlobalError(e?.message ?? "failed to load profile");
    } finally {
      setLoading(false);
    }
  }

  async function decryptCurrent() {
    if (!current) return;
    setBusy(true);
    setStatus("Decrypting...");
    setGlobalError(null);
    try {
      const provider = getBrowserProvider();
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();

      if (isZeroHandle(current.encryptedHandle)) {
        setTokens((prev) =>
          prev.map((t) =>
            t.cToken.toLowerCase() === current.cToken.toLowerCase()
              ? { ...t, decryptedBalance: "0" }
              : t,
          ),
        );
        setStatus("✓ No confidential balance");
        return;
      }

      const value = await decryptHandleForUser({
        handle: current.encryptedHandle,
        contractAddress: current.cToken,
        userAddress,
        signer,
      });

      setTokens((prev) =>
        prev.map((t) =>
          t.cToken.toLowerCase() === current.cToken.toLowerCase()
            ? { ...t, decryptedBalance: formatUnits(value, 6) }
            : t,
        ),
      );
      setStatus("✓ Decrypted");
    } catch (e: any) {
      setGlobalError(e?.message ?? "decrypt failed");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function unwrapCurrent() {
    if (!current) return;
    const amount = unwrapAmount.trim();
    if (!amount) return;

    setBusy(true);
    setStatus("Unwrapping...");
    setGlobalError(null);
    try {
      const res = await unwrapConfidentialToUnderlying({
        cToken: current.cToken,
        amountHuman: amount,
      });
      setUnwrapAmount("");
      setStatus(
        `✓ Unwrapped (${res.unwrapTxHash.slice(0, 10)}..., ${res.finalizeTxHash.slice(0, 10)}...)`,
      );
      await load();
    } catch (e: any) {
      setGlobalError(e?.message ?? "unwrap failed");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 rounded border border-border bg-card p-4">
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          ▸ profile / confidential balances
        </div>
        <div className="mt-2 text-sm text-foreground">
          Wallet: {wallet ? shortAddr(wallet) : "Not connected"}
        </div>
        <button
          onClick={load}
          className="mt-3 rounded border border-border px-3 py-2 text-xs uppercase tracking-wider hover:border-primary hover:text-primary"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
        {globalError && <div className="mt-3 text-sm text-destructive">{globalError}</div>}
      </div>

      <div className="rounded border border-border bg-card p-4">
        <div className="mb-4 grid gap-3 md:grid-cols-[200px_1fr] md:items-end">
          <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Token
          </label>
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setStatus(null);
              setGlobalError(null);
            }}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
          >
            {tokens.map((t) => (
              <option key={t.cToken} value={t.cToken}>
                {t.cSymbol} / {t.underlyingSymbol}
              </option>
            ))}
          </select>
        </div>

        {current ? (
          <>
            <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
              <div className="text-muted-foreground">Confidential Token</div>
              <div className="font-mono">{shortAddr(current.cToken)}</div>

              <div className="text-muted-foreground">Underlying Wallet Balance</div>
              <div>
                {current.underlyingBalance} {current.underlyingSymbol}
              </div>

              <div className="text-muted-foreground">Confidential Balance Handle</div>
              <div className="font-mono">{shortAddr(current.encryptedHandle)}</div>

              <div className="text-muted-foreground">Confidential Balance (decrypted)</div>
              <div>
                {current.decryptedBalance ?? "Encrypted"} {current.cSymbol}
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-[auto_1fr_auto]">
              <button
                disabled={busy}
                onClick={decryptCurrent}
                className="rounded border border-border px-3 py-2 text-xs uppercase tracking-wider hover:border-primary hover:text-primary disabled:opacity-60"
              >
                Decrypt Balance
              </button>

              <input
                value={unwrapAmount}
                onChange={(e) => setUnwrapAmount(e.target.value)}
                placeholder={`Unwrap amount (${current.cSymbol})`}
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              />

              <button
                disabled={busy || !unwrapAmount.trim()}
                onClick={unwrapCurrent}
                className="rounded border border-primary bg-primary/10 px-3 py-2 text-xs uppercase tracking-wider text-primary disabled:opacity-60"
              >
                Unwrap to {current.underlyingSymbol}
              </button>
            </div>

            {status && <div className="mt-3 text-sm text-primary">{status}</div>}
          </>
        ) : (
          <div className="text-sm text-muted-foreground">No confidential tokens configured.</div>
        )}
      </div>
    </div>
  );
}

export default ProfilePage;
