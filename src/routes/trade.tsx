import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { PairKey } from "@/lib/contracts-config";
import { LIVE_PAIRS } from "@/lib/live-pairs";
import { decryptHandleForUser, encryptOrderInputs } from "@/lib/fhe";
import { formatUnits } from "ethers";
import {
  type Side,
  approveConfidentialForEscrow,
  approveUnderlyingForWrapper,
  getBrowserProvider,
  getFundingContractsForPair,
  getFundingStatus,
  getTokenMeta,
  submitEncryptedOrder,
  wrapIntoConfidential,
} from "@/lib/web3";

export const Route = createFileRoute("/trade")({ component: Trade });

function isZeroHandle(handle?: string | null) {
  return !handle || /^0x0{64}$/i.test(handle);
}

function Trade() {
  const [pairId, setPairId] = useState<string>(LIVE_PAIRS[0]?.key ?? "WETH_USDC");
  const [side, setSide] = useState<Side>("Buy");
  const [price, setPrice] = useState("");
  const [size, setSize] = useState("");
  const [fundAmount, setFundAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fundingInfo, setFundingInfo] = useState<any>(null);
  const [fundingError, setFundingError] = useState<string | null>(null);
  const [fundingTarget, setFundingTarget] = useState<{ cToken: string; underlyingToken: string } | null>(null);
  const [fundingTokenSymbol, setFundingTokenSymbol] = useState<string | null>(null);
  const [stepStatus, setStepStatus] = useState<{
    approve?: string;
    wrap?: string;
    escrow?: string;
  }>({});

  const pair = LIVE_PAIRS.find((p) => p.key === pairId) ?? LIVE_PAIRS[0];
  const fundingToken = side === "Buy" ? pair?.tokenB : pair?.tokenA;

  const notional = useMemo(() => {
    if (!price || !size) return "—";
    return (Number(price) * Number(size)).toFixed(6);
  }, [price, size]);

  const sizeNum = Number(size || "0");
  const estSpend = side === "Buy" ? notional : sizeNum > 0 ? sizeNum.toFixed(6) : "—";
  const estReceive = side === "Buy" ? (sizeNum > 0 ? sizeNum.toFixed(6) : "—") : notional;

  async function detectFundingTarget(_owner: string, _signer: Awaited<ReturnType<ReturnType<typeof getBrowserProvider>["getSigner"]>>) {
    // Always trust escrow's canonical route for this side.
    return getFundingContractsForPair({ pairKey: pair.key as PairKey, side });
  }

  async function refreshFundingInfo() {
      if (typeof window === "undefined") return;  // <-- add this line

    if (!pair) return;
    try {
      setFundingError(null);
      const provider = getBrowserProvider();
      const signer = await provider.getSigner();
      const owner = await signer.getAddress();
      const funding = await detectFundingTarget(owner, signer);
      setFundingTarget(funding);
      try {
        const m = await getTokenMeta(funding.underlyingToken);
        setFundingTokenSymbol(m.symbol);
      } catch {
        setFundingTokenSymbol(null);
      }
      let info = await getFundingStatus({
        underlyingToken: funding.underlyingToken,
        cToken: funding.cToken,
        escrow: pair.escrow,
        owner,
        signer,
      });

      if (isZeroHandle(info.confidentialBalanceHandle)) {
        info.confidentialBalance = "0";
      } else {
        try {
          const decrypted = await decryptHandleForUser({
            handle: info.confidentialBalanceHandle,
            contractAddress: funding.cToken,
            userAddress: owner,
            signer,
          });
          info.confidentialBalance = formatUnits(decrypted, 6);
        } catch (e: any) {
          setFundingError(`decrypt failed: ${e?.message ?? "unknown"}`);
        }
      }

      setFundingInfo(info);
      setFundingError(null);
    } catch (e: any) {
      const msg = e?.message ?? "status read failed";
      setFundingError(msg);
      setFundingInfo(null);
    }
  }

  async function handlePrepareFunding() {
    if (!pair || !fundAmount) return;
    setSubmitting(true);
    setStepStatus({});
    try {
      const provider = getBrowserProvider();
      const signer = await provider.getSigner();
      const owner = await signer.getAddress();
      const funding = fundingTarget ?? await detectFundingTarget(owner, signer);
      setFundingTarget(funding);
      setStepStatus((s) => ({ ...s, approve: "Approving underlying token..." }));
      await approveUnderlyingForWrapper({
        underlyingToken: funding.underlyingToken,
        wrapperToken: funding.cToken,
        amountHuman: fundAmount,
      });
      setStepStatus((s) => ({ ...s, approve: "✓ Underlying approved" }));

      setStepStatus((s) => ({ ...s, wrap: "Wrapping to confidential token..." }));
      await wrapIntoConfidential({ wrapperToken: funding.cToken, amountHuman: fundAmount });
      setStepStatus((s) => ({ ...s, wrap: "✓ Wrapped to confidential token" }));

      setStepStatus((s) => ({ ...s, escrow: "Enabling escrow permission..." }));
      await approveConfidentialForEscrow({ cToken: funding.cToken, escrow: pair.escrow, amountHuman: fundAmount });
      setStepStatus((s) => ({ ...s, escrow: "✓ Escrow permission enabled" }));
      setStatus("✓ Funding ready");
      await refreshFundingInfo();
    } catch (e: any) {
      setStatus(`✕ Funding flow failed: ${e?.message ?? "unknown"}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pair || !price || !size) return;
    setSubmitting(true);
    setStatus("Encrypting...");
    try {
      // Contract side now matches UI side.
      const contractSide: Side = side;
      const provider = getBrowserProvider();
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();
      const encrypted = await encryptOrderInputs({
        contractAddress: pair.escrow,
        userAddress,
        priceDecimal: price,
        // Matcher expects buySize and sellSize in same unit (base size).
        sizeDecimal: size,
      });
      const res = await submitEncryptedOrder({
        pairKey: pair.key as PairKey,
        side: contractSide,
        encPriceHandle: encrypted.encPriceHandle,
        priceProof: encrypted.inputProof,
        encSizeHandle: encrypted.encSizeHandle,
        sizeProof: encrypted.inputProof,
      });
      setStatus(`✓ Submitted: ${res.txHash}`);
    } catch (e: any) {
      const msg = String(e?.message ?? "unknown");
      if (msg.includes("0x5ff91cdc")) {
        setStatus("✕ Submit failed: zero confidential balance for required funding token (ERC7984ZeroBalance). Wrap and fund the token used for this side first.");
      } else {
        setStatus(`✕ Submit failed: ${msg}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

useEffect(() => {
  if (typeof window === "undefined") return;
  setFundingTokenSymbol(null);
  refreshFundingInfo();
}, [pairId, side]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 rounded border border-border bg-card p-4">
        <div className="mb-2 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">▸ trade terminal</div>
        <div className="flex flex-wrap gap-3">
          <select value={pairId} onChange={(e) => setPairId(e.target.value)} className="rounded border border-border bg-background px-3 py-2 text-sm text-primary">
          {LIVE_PAIRS.map((p) => <option key={p.key} value={p.key}>{p.tokenA}/{p.tokenB}</option>)}
          </select>
          <button onClick={() => setSide("Buy")} className={`rounded border px-3 py-2 text-xs uppercase tracking-[0.2em] ${side === "Buy" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>Buy</button>
          <button onClick={() => setSide("Sell")} className={`rounded border px-3 py-2 text-xs uppercase tracking-[0.2em] ${side === "Sell" ? "border-destructive bg-destructive/10 text-destructive" : "border-border text-muted-foreground"}`}>Sell</button>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4 rounded border border-border bg-card p-6">
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Funding token for current side: {fundingTokenSymbol ?? "Detecting..."}</div>
        <input value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} placeholder={`Funding Amount (${fundingTokenSymbol ?? fundingToken})`} className="w-full rounded border border-border bg-background px-3 py-3 text-base placeholder:text-muted-foreground/40" />
        <button type="button" onClick={handlePrepareFunding} disabled={submitting || !fundAmount} className="w-full rounded border border-border px-3 py-2 text-[10px] uppercase tracking-[0.2em] hover:border-primary hover:text-primary disabled:opacity-60">Prepare Funding (Approve → Wrap → Approve Escrow)</button>
        {(stepStatus.approve || stepStatus.wrap || stepStatus.escrow) && (
          <div className="rounded border border-border bg-background/20 p-3 text-xs space-y-1">
            {stepStatus.approve && <div>{stepStatus.approve}</div>}
            {stepStatus.wrap && <div>{stepStatus.wrap}</div>}
            {stepStatus.escrow && <div>{stepStatus.escrow}</div>}
          </div>
        )}

        <div className="rounded border border-dashed border-border bg-background/30 p-4 text-sm">
          <div className="mb-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Funding Status</div>
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Funding Token</span><span>{fundingTokenSymbol ?? "—"}</span></div>
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Funding cToken</span><span className="font-mono">{fundingTarget ? `${fundingTarget.cToken.slice(0, 8)}...${fundingTarget.cToken.slice(-6)}` : "—"}</span></div>
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Underlying Balance</span><span>{fundingInfo?.underlyingBalance ?? "—"} {fundingTokenSymbol ?? ""}</span></div>
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Approved to Wrapper</span><span>{fundingInfo?.underlyingAllowanceToWrapper ?? "—"} {fundingTokenSymbol ?? ""}</span></div>
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Available for Trading (confidential)</span><span>{fundingInfo?.confidentialBalance ?? "—"} {fundingTokenSymbol ? `c${fundingTokenSymbol}` : "—"}</span></div>
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Confidential Balance Handle</span><span className="font-mono">{fundingInfo?.confidentialBalanceHandle?.slice(0, 12) ?? "—"}...</span></div>
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Escrow Permission</span><span>{fundingInfo ? (fundingInfo.escrowOperatorEnabled ? "Enabled" : "Not enabled") : "—"}</span></div>
          {fundingError && <div className="mt-2 text-xs text-destructive">status read failed: {fundingError}</div>}
          <button type="button" onClick={refreshFundingInfo} className="mt-3 w-full rounded border border-border px-3 py-2 text-[10px] uppercase tracking-[0.2em] hover:border-primary hover:text-primary">Refresh Funding Status</button>
        </div>

        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price" className="w-full rounded border border-border bg-background px-3 py-3 text-base placeholder:text-muted-foreground/40" />
        <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="Size" className="w-full rounded border border-border bg-background px-3 py-3 text-base placeholder:text-muted-foreground/40" />
        <div className="rounded border border-dashed border-border bg-background/30 p-3 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">Price</span><span>{price || "—"} {pair?.tokenB}/{pair?.tokenA}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Size</span><span>{size || "—"} {pair?.tokenA}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Est. Notional</span><span>{notional} {pair?.tokenB}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Est. Spend</span><span>{estSpend} {side === "Buy" ? pair?.tokenB : pair?.tokenA}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Est. Receive</span><span>{estReceive} {side === "Buy" ? pair?.tokenA : pair?.tokenB}</span></div>
        </div>
        <button type="submit" disabled={submitting || !price || !size} className="w-full rounded border border-primary bg-primary/10 px-3 py-3 text-xs uppercase tracking-[0.3em] text-primary disabled:opacity-60">Encrypt & Submit {side}</button>
        {status && <div className="rounded border border-primary/30 bg-primary/5 p-2 text-sm text-primary">{status}</div>}
      </form>
    </div>
  );
}

export default Trade;

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    Open: "border-primary/40 text-primary bg-primary/10",
    PartiallyFilled: "border-yellow-500/40 text-yellow-500 bg-yellow-500/10",
    Filled: "border-primary/40 text-primary bg-primary/10",
    Locked: "border-yellow-500/40 text-yellow-500 bg-yellow-500/10",
    Matched: "border-primary/40 text-primary bg-primary/10",
    Cancelled: "border-destructive/40 text-destructive bg-destructive/10",
    Refunded: "border-terminal-dim/40 text-terminal-dim bg-terminal-dim/10",
    Pending: "border-terminal-dim/40 text-terminal-dim bg-terminal-dim/10",
    Unknown: "border-border text-muted-foreground bg-background/40",
  };
  return (
    <span className={`rounded border px-2 py-0.5 text-[9px] uppercase tracking-widest ${map[status] ?? "border-border text-muted-foreground"}`}>
      {status}
    </span>
  );
}
