import { ethers } from "ethers";
import { CONTRACTS } from "@/lib/contracts-config";
import type { PairKey } from "@/lib/contracts-config";
import { encryptUint64Input, publicDecryptUint64Handle } from "@/lib/fhe";

const ESCROW_ABI = [
  "event SellOrderSubmitted(uint256 indexed orderId, address indexed seller)",
  "event BuyOrderSubmitted(uint256 indexed orderId, address indexed buyer)",
  "event OrderCancelled(uint256 indexed orderId, address indexed trader)",
  "function cTokenA() view returns (address)",
  "function cTokenB() view returns (address)",
  "function activeSellOrderId() view returns (uint256)",
  "function activeBuyOrderId() view returns (uint256)",
  "function nextOrderId() view returns (uint256)",
  "function submitSellOrder(bytes32 encMinPrice, bytes priceProof, bytes32 encSellSize, bytes sizeProof) returns (uint256)",
  "function submitBuyOrder(bytes32 encBidPrice, bytes priceProof, bytes32 encBuySize, bytes sizeProof) returns (uint256)",
  "function cancelOrder(uint256 orderId)",
  "function orders(uint256) view returns (uint256 id, address trader, uint8 side, bytes32 encPrice, bytes32 encSize, uint8 status, uint64 createdAt)",
] as const;

const ACL_ERROR_IFACE = new ethers.Interface([
  "error ACLNotAllowed(bytes32 handle, address account)",
]);

const MATCHER_ABI = [
  "event MatchRequested(uint256 indexed requestId, uint256 indexed sellOrderId, uint256 indexed buyOrderId)",
  "event MatchResolved(uint256 indexed requestId, bool matched)",
  "event PartialFill(uint256 indexed requestId, uint256 indexed smallerOrderId, uint256 indexed remainderOrderId)",
] as const;

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

const WRAPPER_ABI = [
  ...ERC20_ABI,
  "function underlying() view returns (address)",
  "function wrap(address to, uint256 amount) returns (bytes32)",
  "function unwrap(address from, address to, bytes32 encryptedAmount, bytes inputProof) returns (bytes32)",
  "function finalizeUnwrap(bytes32 unwrapRequestId, uint64 unwrapAmountCleartext, bytes decryptionProof)",
  "function setOperator(address operator, uint48 until)",
  "function confidentialBalanceOf(address account) view returns (bytes32)",
  "event UnwrapRequested(address indexed receiver, bytes32 indexed unwrapRequestId, bytes32 amount)",
  "event UnwrapFinalized(address indexed receiver, bytes32 indexed unwrapRequestId, bytes32 encryptedAmount, uint64 cleartextAmount)",
] as const;
const wrapperByUnderlyingCache = new Map<string, string>();

export type Side = "Buy" | "Sell";
export type OrderStatus = "Pending" | "Open" | "PartiallyFilled" | "Filled" | "Cancelled" | "Refunded" | "Unknown";

export type ChainOrder = {
  orderId: string;
  pairKey: PairKey;
  pairLabel: string;
  side: Side;
  trader: string;
  txHash: string;
  blockNumber: number;
  timestamp: number;
  status: OrderStatus;
};

export type ChainActivity = {
  id: string;
  pairLabel: string;
  txHash: string;
  blockNumber: number;
  timestamp: number;
  type: "ORDER_SUBMIT_BUY" | "ORDER_SUBMIT_SELL" | "ORDER_CANCELLED" | "MATCH_REQUESTED" | "MATCHED" | "NO_MATCH" | "PARTIAL_FILL";
};

const MAX_LOG_BLOCK_SPAN = 40_000;

function mapOrderStatus(raw: number): OrderStatus {
  // Solidity enum OrderStatus:
  // 0 None, 1 Open, 2 PartiallyFilled, 3 Filled, 4 Cancelled, 5 Refunded
  if (raw === 1) return "Open";
  if (raw === 2) return "PartiallyFilled";
  if (raw === 3) return "Filled";
  if (raw === 4) return "Cancelled";
  if (raw === 5) return "Refunded";
  if (raw === 0) return "Pending";
  return "Unknown";
}

function getEthereum(): ethers.Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { ethereum?: ethers.Eip1193Provider };
  return w.ethereum ?? null;
}

export function getBrowserProvider(): ethers.BrowserProvider {
  const eth = getEthereum();
  if (!eth) throw new Error("No injected wallet found");
  return new ethers.BrowserProvider(eth);
}

export function getRpcProvider(): ethers.JsonRpcProvider {
  const rpc = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_SEPOLIA_RPC_URL
    || "https://ethereum-sepolia-rpc.publicnode.com";
  return new ethers.JsonRpcProvider(rpc, 11155111);
}

async function queryFilterChunked(
  contract: ethers.Contract,
  filter: ethers.EventFilter,
  provider: ethers.Provider,
  fromBlock = 0,
): Promise<ethers.EventLog[]> {
  const latest = await provider.getBlockNumber();
  const effectiveFrom = fromBlock === 0 ? Math.max(0, latest - 150_000) : fromBlock;
  const out: ethers.EventLog[] = [];
  for (let start = effectiveFrom; start <= latest; start += MAX_LOG_BLOCK_SPAN + 1) {
    const end = Math.min(start + MAX_LOG_BLOCK_SPAN, latest);
    const logs = await contract.queryFilter(filter, start, end);
    out.push(...(logs as ethers.EventLog[]));
  }
  return out;
}

export function getEscrowContract(pairKey: PairKey, signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(CONTRACTS.pairs[pairKey].escrow, ESCROW_ABI, signerOrProvider);
}

function extractHexData(err: any): string | null {
  const values = [
    err?.data,
    err?.revert?.data,
    err?.error?.data,
    err?.info?.error?.data,
    err?.receipt?.revertReason,
  ];
  for (const v of values) {
    if (typeof v === "string" && v.startsWith("0x")) return v;
  }
  return null;
}

export async function explainSubmitFailure(args: { pairKey: PairKey; side: Side; error: unknown }) {
  const e = args.error as any;
  const message = String(e?.message ?? "unknown");
  const data = extractHexData(e);
  if (!data) return null;

  try {
    const parsed = ACL_ERROR_IFACE.parseError(data);
    if (parsed?.name === "ACLNotAllowed") {
      const blockedHandle = String(parsed.args[0]);
      const blockedAddress = String(parsed.args[1]).toLowerCase();
      const expectedMatcher = CONTRACTS.pairs[args.pairKey].matcher.toLowerCase();
      let note = "";
      if (blockedAddress === expectedMatcher) {
        const provider = getRpcProvider();
        const escrow = getEscrowContract(args.pairKey, provider);
        const [sellId, buyId] = await Promise.all([
          escrow.activeSellOrderId(),
          escrow.activeBuyOrderId(),
        ]);
        const oppositeHeadId = args.side === "Sell" ? buyId : sellId;
        if (oppositeHeadId > 0n) {
          const opposite = await escrow.orders(oppositeHeadId);
          note =
            ` Opposite head order #${oppositeHeadId.toString()} (trader ${String(opposite.trader)}) ` +
            "is likely using a ciphertext not ACL-authorized for the current matcher.";
        }
      }
      return {
        code: "ACL_NOT_ALLOWED",
        blockedHandle,
        blockedAddress,
        userMessage:
          `Submit failed: matcher is not allowed to process a required encrypted handle (${blockedHandle.slice(0, 12)}...).` +
          note,
      } as const;
    }
  } catch {
    // ignore parse failures
  }

  if (message.includes("0x5ff91cdc")) {
    return {
      code: "ZERO_CONFIDENTIAL_BALANCE",
      userMessage:
        "Submit failed: zero confidential balance for required funding token (ERC7984ZeroBalance). Wrap/fund this side first.",
    } as const;
  }

  return null;
}

export async function submitEncryptedOrder(args: {
  pairKey: PairKey;
  side: Side;
  encPriceHandle: ethers.BytesLike;
  priceProof: ethers.BytesLike;
  encSizeHandle: ethers.BytesLike;
  sizeProof: ethers.BytesLike;
}) {
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const escrow = getEscrowContract(args.pairKey, signer);
  const tx =
    args.side === "Sell"
      ? await escrow.submitSellOrder(args.encPriceHandle, args.priceProof, args.encSizeHandle, args.sizeProof)
      : await escrow.submitBuyOrder(args.encPriceHandle, args.priceProof, args.encSizeHandle, args.sizeProof);
  const receipt = await tx.wait();
  return { txHash: tx.hash as string, receipt };
}

export async function cancelOrder(pairKey: PairKey, orderId: string) {
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const escrow = getEscrowContract(pairKey, signer);
  const tx = await escrow.cancelOrder(BigInt(orderId));
  const receipt = await tx.wait();
  return { txHash: tx.hash as string, receipt };
}

export async function getOrderEncryptedHandles(pairKey: PairKey, orderId: string) {
  const provider = getRpcProvider();
  const escrow = getEscrowContract(pairKey, provider);
  const row = await escrow.orders(BigInt(orderId));
  return {
    escrow: CONTRACTS.pairs[pairKey].escrow,
    encPrice: String(row.encPrice),
    encSize: String(row.encSize),
  };
}

export async function getTokenMeta(token: string) {
  const provider = getRpcProvider();
  const c = new ethers.Contract(token, ERC20_ABI, provider);
  const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()]);
  return { symbol: String(symbol), decimals: Number(decimals) };
}

export async function getFundingStatus(args: {
  underlyingToken: string;
  cToken: string;
  escrow: string;
  owner: string;
  signer?: ethers.Signer;
}) {
  let provider: ethers.Provider;
  try {
    const browser = getBrowserProvider();
    await browser.getNetwork();
    provider = browser;
  } catch {
    provider = getRpcProvider();
  }
  const u = new ethers.Contract(args.underlyingToken, ERC20_ABI, provider);
  const cRead = new ethers.Contract(
    args.cToken,
    [
      ...WRAPPER_ABI,
      "function isOperator(address holder, address spender) view returns (bool)",
    ],
    provider,
  );
  const cCaller = new ethers.Contract(
    args.cToken,
    [
      ...WRAPPER_ABI,
      "function isOperator(address holder, address spender) view returns (bool)",
    ],
    args.signer ?? provider,
  );

  const [uDecimals, uBal, uAllowance] = await Promise.all([
    u.decimals(),
    u.balanceOf(args.owner),
    u.allowance(args.owner, args.cToken),
  ]);
  let cBalEncrypted: string;
  try {
    cBalEncrypted = String(await cCaller.confidentialBalanceOf(args.owner));
  } catch {
    cBalEncrypted = String(await cRead.confidentialBalanceOf(args.owner));
  }

  let escrowOperatorEnabled = false;
  try {
    escrowOperatorEnabled = Boolean(await cRead.isOperator(args.owner, args.escrow));
  } catch {
    escrowOperatorEnabled = false;
  }

  return {
    underlyingBalance: ethers.formatUnits(uBal, Number(uDecimals)),
    confidentialBalance: "Encrypted",
    confidentialBalanceHandle: String(cBalEncrypted),
    underlyingAllowanceToWrapper: ethers.formatUnits(uAllowance, Number(uDecimals)),
    escrowOperatorEnabled,
  };
}

export async function getFundingContractsForPair(args: {
  pairKey: PairKey;
  side: Side;
}): Promise<{ cToken: string; underlyingToken: string }> {
  let provider: ethers.Provider;
  try {
    const browser = getBrowserProvider();
    await browser.getNetwork();
    provider = browser;
  } catch {
    provider = getRpcProvider();
  }
  const escrow = getEscrowContract(args.pairKey, provider);
  // Funding token is what trader pays in UI semantics.
  // Standard orientation: cTokenA=base and cTokenB=quote.
  // UI Buy (buy base/pay quote) => cTokenB, UI Sell => cTokenA.
  const cToken = args.side === "Buy" ? String(await escrow.cTokenB()) : String(await escrow.cTokenA());
  const wrapper = new ethers.Contract(cToken, WRAPPER_ABI, provider);
  const underlyingToken = String(await wrapper.underlying());
  return { cToken, underlyingToken };
}

export async function approveUnderlyingForWrapper(args: {
  underlyingToken: string;
  wrapperToken: string;
  amountHuman: string;
}) {
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const erc20 = new ethers.Contract(args.underlyingToken, ERC20_ABI, signer);
  const decimals = Number(await erc20.decimals());
  const amount = ethers.parseUnits(args.amountHuman, decimals);
  const tx = await erc20.approve(args.wrapperToken, amount);
  const receipt = await tx.wait();
  return { txHash: tx.hash as string, receipt };
}

export async function findWrapperForUnderlying(underlyingToken: string): Promise<string> {
  const key = underlyingToken.toLowerCase();
  const cached = wrapperByUnderlyingCache.get(key);
  if (cached) return cached;

  const provider = getRpcProvider();
  const allWrappers = Object.values(CONTRACTS.wrappers);
  for (const wrapperAddr of allWrappers) {
    try {
      const wrapper = new ethers.Contract(wrapperAddr, WRAPPER_ABI, provider);
      const underlying = String(await wrapper.underlying()).toLowerCase();
      if (underlying === key) {
        wrapperByUnderlyingCache.set(key, wrapperAddr);
        return wrapperAddr;
      }
    } catch {
      // ignore non-wrapper entries or read failures
    }
  }
  throw new Error(`No wrapper found for underlying ${underlyingToken}`);
}

export async function wrapIntoConfidential(args: {
  wrapperToken: string;
  amountHuman: string;
}) {
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const wrapper = new ethers.Contract(args.wrapperToken, WRAPPER_ABI, signer);
  const underlying = String(await wrapper.underlying());
  const u = new ethers.Contract(underlying, ERC20_ABI, signer);
  const decimals = Number(await u.decimals());
  const amount = ethers.parseUnits(args.amountHuman, decimals);
  const to = await signer.getAddress();
  const tx = await wrapper.wrap(to, amount);
  const receipt = await tx.wait();
  return { txHash: tx.hash as string, receipt };
}

export async function approveConfidentialForEscrow(args: {
  cToken: string;
  escrow: string;
  amountHuman: string;
}) {
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const c = new ethers.Contract(args.cToken, WRAPPER_ABI, signer);
  const now = Math.floor(Date.now() / 1000);
  const oneYear = 365 * 24 * 60 * 60;
  const until = now + oneYear;
  const tx = await c.setOperator(args.escrow, until);
  const receipt = await tx.wait();
  return { txHash: tx.hash as string, receipt };
}

export function getConfidentialTokens() {
  return Object.entries(CONTRACTS.wrappers).map(([symbol, address]) => ({
    symbol,
    address,
  }));
}

export async function getConfidentialTokenStatus(args: {
  cToken: string;
  owner: string;
  signer?: ethers.Signer;
}) {
  const provider = getRpcProvider();
  const wrapperRead = new ethers.Contract(args.cToken, WRAPPER_ABI, provider);
  const wrapperCaller = new ethers.Contract(args.cToken, WRAPPER_ABI, args.signer ?? provider);
  const underlying = String(await wrapperRead.underlying());
  const underlyingErc20 = new ethers.Contract(underlying, ERC20_ABI, provider);
  const [cSymbol, uSymbol, uDecimals, uBalance] = await Promise.all([
    wrapperRead.symbol(),
    underlyingErc20.symbol(),
    underlyingErc20.decimals(),
    underlyingErc20.balanceOf(args.owner),
  ]);
  let encryptedHandle: string;
  try {
    encryptedHandle = String(await wrapperCaller.confidentialBalanceOf(args.owner));
  } catch {
    encryptedHandle = String(await wrapperRead.confidentialBalanceOf(args.owner));
  }
  return {
    cToken: args.cToken,
    cSymbol: String(cSymbol),
    underlying,
    underlyingSymbol: String(uSymbol),
    underlyingBalance: ethers.formatUnits(uBalance, Number(uDecimals)),
    encryptedHandle,
  };
}

export async function unwrapConfidentialToUnderlying(args: {
  cToken: string;
  amountHuman: string;
}) {
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const owner = await signer.getAddress();
  const wrapper = new ethers.Contract(args.cToken, WRAPPER_ABI, signer);
  const enc = await encryptUint64Input({
    contractAddress: args.cToken,
    userAddress: owner,
    amountDecimal: args.amountHuman,
    decimals: 6,
  });

  const tx = await wrapper.unwrap(owner, owner, enc.encHandle, enc.inputProof);
  const receipt = await tx.wait();

  const unwrapIface = new ethers.Interface(WRAPPER_ABI);
  let unwrapRequestId = "";
  for (const log of receipt.logs) {
    try {
      const parsed = unwrapIface.parseLog({ topics: (log as any).topics, data: (log as any).data });
      if (parsed?.name === "UnwrapRequested") {
        unwrapRequestId = String(parsed.args.unwrapRequestId);
        break;
      }
    } catch {
      // ignore unrelated logs
    }
  }
  if (!unwrapRequestId) {
    throw new Error("unwrap request id not found in logs");
  }

  const dec = await publicDecryptUint64Handle(unwrapRequestId);
  const tx2 = await wrapper.finalizeUnwrap(unwrapRequestId, dec.clearValue, dec.decryptionProof);
  const receipt2 = await tx2.wait();

  return {
    unwrapTxHash: tx.hash as string,
    finalizeTxHash: tx2.hash as string,
    unwrapReceipt: receipt,
    finalizeReceipt: receipt2,
  };
}

export async function fetchOrdersForAddress(address: string, pairKeys: PairKey[]): Promise<ChainOrder[]> {
  const provider = getRpcProvider();
  const normalized = address.toLowerCase();
  const byBlock = new Map<number, number>();
  const rows: ChainOrder[] = [];

  for (const pairKey of pairKeys) {
    const pair = CONTRACTS.pairs[pairKey];
    const pairLabel = pairKey.replace("_", "/");
    const [baseSymbol, quoteSymbol] = pairKey.split("_");
    const baseUnderlying = CONTRACTS.underlyings[baseSymbol as keyof typeof CONTRACTS.underlyings]?.toLowerCase();
    const quoteUnderlying = CONTRACTS.underlyings[quoteSymbol as keyof typeof CONTRACTS.underlyings]?.toLowerCase();
    const escrow = getEscrowContract(pairKey, provider);
    const cTokenAAddr = String(await escrow.cTokenA());
    const cTokenA = new ethers.Contract(cTokenAAddr, WRAPPER_ABI, provider);
    const cTokenAUnderlying = String(await cTokenA.underlying()).toLowerCase();
    // If escrow cTokenA is quote token, contract Sell corresponds to UI Buy (and contract Buy to UI Sell).
    const invertSideForUi = quoteUnderlying !== undefined && cTokenAUnderlying === quoteUnderlying && baseUnderlying !== quoteUnderlying;

    const sellEvents = await queryFilterChunked(escrow, escrow.filters.SellOrderSubmitted(), provider);
    for (const e of sellEvents) {
      if (!e.args) continue;
      if (String(e.args.seller).toLowerCase() !== normalized) continue;
      byBlock.set(e.blockNumber, 0);
      rows.push({
        orderId: e.args.orderId.toString(),
        pairKey,
        pairLabel,
        side: invertSideForUi ? "Buy" : "Sell",
        trader: e.args.seller,
        txHash: e.transactionHash,
        blockNumber: e.blockNumber,
        timestamp: 0,
        status: "Pending",
      });
    }

    const buyEvents = await queryFilterChunked(escrow, escrow.filters.BuyOrderSubmitted(), provider);
    for (const e of buyEvents) {
      if (!e.args) continue;
      if (String(e.args.buyer).toLowerCase() !== normalized) continue;
      byBlock.set(e.blockNumber, 0);
      rows.push({
        orderId: e.args.orderId.toString(),
        pairKey,
        pairLabel,
        side: invertSideForUi ? "Sell" : "Buy",
        trader: e.args.buyer,
        txHash: e.transactionHash,
        blockNumber: e.blockNumber,
        timestamp: 0,
        status: "Pending",
      });
    }

    const relevantRows = rows.filter((r) => r.pairKey === pairKey);
    await Promise.all(
      relevantRows.map(async (row) => {
        try {
          const order = await escrow.orders(BigInt(row.orderId));
          row.status = mapOrderStatus(Number(order.status));
        } catch {
          // keep event-derived fallback status
        }
      }),
    );

    // Fallback reconciliation: scan on-chain order storage directly for this trader.
    // This surfaces orders that may be missing from event indexing windows/provider inconsistencies.
    let nextOrderId = 0n;
    try {
      nextOrderId = await escrow.nextOrderId();
    } catch {
      nextOrderId = 0n;
    }
    const lowerBound = nextOrderId > 500n ? nextOrderId - 500n : 1n;
    const existing = new Set(rows.filter((r) => r.pairKey === pairKey).map((r) => `${r.pairKey}:${r.orderId}`));
    for (let id = lowerBound; id < nextOrderId; id++) {
      try {
        const order = await escrow.orders(id);
        const trader = String(order.trader);
        if (trader.toLowerCase() !== normalized) continue;
        const orderId = id.toString();
        if (existing.has(`${pairKey}:${orderId}`)) continue;
        const rawSide = Number(order.side);
        const side: Side =
          rawSide === 0
            ? (invertSideForUi ? "Buy" : "Sell")
            : (invertSideForUi ? "Sell" : "Buy");
        const createdAtMs = Number(order.createdAt) * 1000;
        rows.push({
          orderId,
          pairKey,
          pairLabel,
          side,
          trader,
          txHash: "0x",
          blockNumber: 0,
          timestamp: createdAtMs > 0 ? createdAtMs : Date.now(),
          status: mapOrderStatus(Number(order.status)),
        });
      } catch {
        // ignore sparse/malformed rows
      }
    }
  }

  await Promise.all(
    Array.from(byBlock.keys()).map(async (bn) => {
      const block = await provider.getBlock(bn);
      byBlock.set(bn, Number(block?.timestamp ?? 0) * 1000);
    }),
  );

  for (const row of rows) row.timestamp = byBlock.get(row.blockNumber) ?? Date.now();
  return rows.sort((a, b) => b.blockNumber - a.blockNumber);
}

export async function fetchActivity(pairKeys: PairKey[]): Promise<ChainActivity[]> {
  const provider = getRpcProvider();
  const result: ChainActivity[] = [];
  const ts = new Map<number, number>();

  for (const pairKey of pairKeys) {
    const pairLabel = pairKey.replace("_", "/");
    const escrow = getEscrowContract(pairKey, provider);
    const matcher = new ethers.Contract(CONTRACTS.pairs[pairKey].matcher, MATCHER_ABI, provider);

    const submittedSell = await queryFilterChunked(
      escrow,
      escrow.filters.SellOrderSubmitted(),
      provider,
    );
    for (const e of submittedSell) {
      ts.set(e.blockNumber, 0);
      result.push({
        id: `${e.transactionHash}-os-${e.index}`,
        pairLabel,
        txHash: e.transactionHash,
        blockNumber: e.blockNumber,
        timestamp: 0,
        type: "ORDER_SUBMIT_SELL",
      });
    }

    const submittedBuy = await queryFilterChunked(
      escrow,
      escrow.filters.BuyOrderSubmitted(),
      provider,
    );
    for (const e of submittedBuy) {
      ts.set(e.blockNumber, 0);
      result.push({
        id: `${e.transactionHash}-ob-${e.index}`,
        pairLabel,
        txHash: e.transactionHash,
        blockNumber: e.blockNumber,
        timestamp: 0,
        type: "ORDER_SUBMIT_BUY",
      });
    }

    const cancelled = await queryFilterChunked(
      escrow,
      escrow.filters.OrderCancelled(),
      provider,
    );
    for (const e of cancelled) {
      ts.set(e.blockNumber, 0);
      result.push({
        id: `${e.transactionHash}-oc-${e.index}`,
        pairLabel,
        txHash: e.transactionHash,
        blockNumber: e.blockNumber,
        timestamp: 0,
        type: "ORDER_CANCELLED",
      });
    }

    const requested = await queryFilterChunked(
      matcher,
      matcher.filters.MatchRequested(),
      provider,
    );
    for (const e of requested) {
      ts.set(e.blockNumber, 0);
      result.push({
        id: `${e.transactionHash}-req-${e.index}`,
        pairLabel,
        txHash: e.transactionHash,
        blockNumber: e.blockNumber,
        timestamp: 0,
        type: "MATCH_REQUESTED",
      });
    }

    const resolved = await queryFilterChunked(
      matcher,
      matcher.filters.MatchResolved(),
      provider,
    );
    for (const e of resolved) {
      ts.set(e.blockNumber, 0);
      result.push({
        id: `${e.transactionHash}-res-${e.index}`,
        pairLabel,
        txHash: e.transactionHash,
        blockNumber: e.blockNumber,
        timestamp: 0,
        type: e.args?.matched ? "MATCHED" : "NO_MATCH",
      });
    }

    const partial = await queryFilterChunked(
      matcher,
      matcher.filters.PartialFill(),
      provider,
    );
    for (const e of partial) {
      ts.set(e.blockNumber, 0);
      result.push({
        id: `${e.transactionHash}-par-${e.index}`,
        pairLabel,
        txHash: e.transactionHash,
        blockNumber: e.blockNumber,
        timestamp: 0,
        type: "PARTIAL_FILL",
      });
    }
  }

  await Promise.all(
    Array.from(ts.keys()).map(async (bn) => {
      const block = await provider.getBlock(bn);
      ts.set(bn, Number(block?.timestamp ?? 0) * 1000);
    }),
  );

  for (const row of result) row.timestamp = ts.get(row.blockNumber) ?? Date.now();
  return result.sort((a, b) => b.blockNumber - a.blockNumber).slice(0, 100);
}
