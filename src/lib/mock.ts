// Mock data shared across pages
export type Pair = { id: string; tokenA: string; tokenB: string; buySlot: boolean; sellSlot: boolean };
export type OrderStatus = "Open" | "Locked" | "Matched" | "Cancelled";
export type Side = "Buy" | "Sell";
export type Order = {
  id: string;
  pair: string;
  side: Side;
  status: OrderStatus;
  timestamp: number;
  encryptedSize: string;
};
export type ActivityEvent = {
  id: string;
  orderId: string;
  pair: string;
  type: "MATCHED" | "NO_MATCH" | "PARTIAL_FILL" | "SETTLED";
  timestamp: number;
};

export const PAIRS: Pair[] = [
  { id: "wbtc-usdc", tokenA: "WBTC", tokenB: "USDC", buySlot: true, sellSlot: false },
  { id: "weth-usdc", tokenA: "WETH", tokenB: "USDC", buySlot: true, sellSlot: true },
  { id: "weth-dai", tokenA: "WETH", tokenB: "DAI", buySlot: false, sellSlot: false },
  { id: "link-usdc", tokenA: "LINK", tokenB: "USDC", buySlot: false, sellSlot: true },
  { id: "uni-weth", tokenA: "UNI", tokenB: "WETH", buySlot: true, sellSlot: false },
  { id: "arb-usdc", tokenA: "ARB", tokenB: "USDC", buySlot: false, sellSlot: false },
];

export const ORDERS: Order[] = [
  { id: "0xa1f3e", pair: "WBTC/USDC", side: "Buy", status: "Open", timestamp: Date.now() - 1000 * 60 * 4, encryptedSize: "0x9f2c…ae71" },
  { id: "0xb22ce", pair: "WETH/USDC", side: "Sell", status: "Locked", timestamp: Date.now() - 1000 * 60 * 22, encryptedSize: "0x7d10…ff03" },
  { id: "0xc019d", pair: "WETH/USDC", side: "Buy", status: "Matched", timestamp: Date.now() - 1000 * 60 * 60 * 2, encryptedSize: "0x441a…8b9c" },
  { id: "0xd9023", pair: "LINK/USDC", side: "Sell", status: "Cancelled", timestamp: Date.now() - 1000 * 60 * 60 * 26, encryptedSize: "0x10ee…5512" },
];

export const ACTIVITY: ActivityEvent[] = [
  { id: "e1", orderId: "0xa44b1", pair: "WBTC/USDC", type: "MATCHED", timestamp: Date.now() - 1000 * 30 },
  { id: "e2", orderId: "0xc91ee", pair: "WETH/USDC", type: "PARTIAL_FILL", timestamp: Date.now() - 1000 * 90 },
  { id: "e3", orderId: "0x7712a", pair: "LINK/USDC", type: "NO_MATCH", timestamp: Date.now() - 1000 * 60 * 4 },
  { id: "e4", orderId: "0x88234", pair: "WETH/USDC", type: "SETTLED", timestamp: Date.now() - 1000 * 60 * 8 },
  { id: "e5", orderId: "0xff019", pair: "UNI/WETH", type: "MATCHED", timestamp: Date.now() - 1000 * 60 * 12 },
  { id: "e6", orderId: "0x12abc", pair: "WBTC/USDC", type: "SETTLED", timestamp: Date.now() - 1000 * 60 * 18 },
  { id: "e7", orderId: "0x903ed", pair: "ARB/USDC", type: "NO_MATCH", timestamp: Date.now() - 1000 * 60 * 40 },
];

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
