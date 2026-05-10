# Trustless Order Automation Plan

This document captures how to run the dark pool as "post once, then auto-run" with minimal user actions and no privileged human operator.

## Goal

- Trader submits one encrypted order.
- Order stays pending until matched or canceled by the same trader.
- Matching and settlement can be triggered by anyone (permissionless keepers/bots).
- No owner-controlled manual settlement path.

## Target Contract Behavior

1. Order submission

- `submitSellOrder` and `submitBuyOrder` lock confidential tokens in escrow.
- Contract emits `OrderSubmitted(orderId, side, pairId)`.

2. Permissionless match attempt

- Add a public function (example: `tryResolveOrder(orderId)` or `matchTopOfBook(pairId)`).
- Any address can call it.
- Function requests encrypted comparison and schedules callback via Gateway.

3. Verified callback only

- `resolveMatch` must only accept Gateway-authenticated callbacks.
- Remove owner-only simulation callbacks in production path.

4. Match result handling

- If price and side conditions match: execute settlement.
- If partial fill: create encrypted remainder order and keep it pending.
- If no match: keep both orders pending without state loss.

5. Cancellation

- `cancelOrder(orderId)` callable only by original order owner.
- Escrow returns remaining confidential balance to owner.

## Why This Is Trust-Minimized

- No single privileged trader, operator, or admin needs to execute each trade.
- Any independent keeper can progress pending orders.
- Traders retain unilateral control only over their own order cancel action.
- The only protocol dependency is FHE Gateway/Coprocessor infrastructure for callback/decryption flow.

## Frontend UX (Post Once)

1. User wraps underlying token to confidential token.
2. User approves escrow.
3. User submits encrypted order once.
4. UI polls order status:

- `PENDING`
- `PARTIAL_FILL`
- `FILLED`
- `CANCELLED`

5. No further action needed unless user chooses cancel or unwrap.

## Vercel Cron Resolver (Now Added)

- A serverless resolver endpoint exists at `/api/resolve-matches`.
- `vercel.json` schedules it every minute (`* * * * *`).
- The job:

1. Scans `MatchRequested` events for each matcher in `src/lib/contracts-config.ts`.
2. Checks each `requestId` is still pending.
3. Fetches handles via `getPendingHandles(requestId)`.
4. Uses Zama relayer SDK node runtime (`publicDecrypt`) to get cleartexts + proof.
5. Calls `resolveMatchWithProof` from the configured gateway signer.

### Required Env Vars for Cron

- `SEPOLIA_RPC_URL`
- `GATEWAY_PRIVATE_KEY`
- `CRON_SECRET` (recommended; protects endpoint)
- `ZAMA_API_KEY` (optional, if your relayer setup needs auth)
- `MATCHER_LOOKBACK_BLOCKS` (optional, default `120000`)

## Suggested Next Contract Tasks

1. Add permissionless keeper entrypoint(s) for retry/match loops.
2. Enforce strict Gateway callback auth in matcher.
3. Add integration tests:

- full fill
- partial fill
- no match remains pending
- cancel returns funds

4. Remove all owner-simulation code paths from production contracts.
