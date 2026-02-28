# Minted Protocol — Frontend Layout Specification

> Design reference for the complete site layout, navigation, page structure, and component hierarchy.

---

## Global Shell

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  NAVBAR  (sticky top, glass blur, z-50)                                     │
│  ┌──────────┬────────────────────────────────────────┬───────────────────┐   │
│  │  Logo    │  Navigation Tabs                       │  Right Controls   │   │
│  │  Minted  │  Mint · Stake ·                        │  [ETH ⟷ Canton]  │   │
│  │  Protocol│  Borrow & Lend · Bridge · Admin         │  [Connect Wallet] │   │
│  └──────────┴────────────────────────────────────────┴───────────────────┘   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  MAIN CONTENT AREA  (max-w-7xl, px-4/6/8, py-8)                            │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                                                                      │    │
│  │               << Active Page Renders Here >>                         │    │
│  │                                                                      │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  FOOTER  (border-t, text-gray-500)                                          │
│  ● All systems operational          Docs · GitHub · Discord    © 2026 Minted│
└──────────────────────────────────────────────────────────────────────────────┘
```

### Chain Toggle
- Pill toggle in the navbar: **Ethereum** (blue/brand) ⟷ **Canton** (amber/yellow)
- Entire app swaps between Ethereum pages and Canton pages based on selection
- Navbar active-tab underline color follows chain (brand-500 vs amber-500)

### Mobile
- Hamburger button replaces nav tabs at `< lg` breakpoint
- Slide-down menu with full-width nav items

---

## Navigation Items

| Key         | Label          | Page Component (ETH)     | Page Component (Canton)    |
|-------------|----------------|--------------------------|----------------------------|
| `mint`      | Mint           | `DashboardMintPage`      | `CantonDashboardMint`      |
| `stake`     | Stake          | `StakePage`              | `CantonStake`              |
| `borrow`    | Borrow & Lend  | `BorrowPage`             | `CantonBorrow`             |
| `bridge`    | Bridge         | `BridgePage`             | `CantonBridge`             |
| `admin`     | Admin          | `AdminPage`              | `CantonAdmin`              |
| `points`    | Points         | `PointsPage`             | `PointsPage`               |

---

## Page Layouts

### 0. Landing Page (pre-app gate) — `LandingPage.tsx`

Shown before the user enters the app. Full-screen, no scrollable content below.

```
┌──────────────────────────────────────────────────────────────────┐
│  THREE.js Animated Scene (full viewport, behind all content)     │
│  • 2000 particles (spherical distribution, additive blending)    │
│  • Central glowing orb (fresnel shader, pulsing)                 │
│  • 3 orbiting torus rings (brand-blue, purple, amber)            │
│  • Neural-network connection lines between nearby particles      │
│  • Mouse-follow camera (smooth lerp)                             │
│  • Dark vignette overlay for text legibility                     │
├──────────────────────────────────────────────────────────────────┤
│  NAV BAR (z-20, minimal)                                         │
│  ┌──────────┐                                    ┌─────────────┐│
│  │ Logo     │                                    │ [Enter App] ││
│  │ Minted   │                                    │  gradient    ││
│  │ Protocol │                                    │  button      ││
│  └──────────┘                                    └─────────────┘│
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│          "The currency for the"                                  │
│          "Web3 Ownership Economy"   (gradient text)              │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────────────┐│
│  │ mUSD     │ │ Staking  │ │ Active   │ │ Canton Attestation  ││
│  │ Supply   │ │ APY      │ │ Users    │ │ Value               ││
│  │ 24.8M    │ │ 12.4%    │ │ 3,847    │ │ 18.2M               ││
│  └──────────┘ └──────────┘ └──────────┘ └─────────────────────┘│
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

No other buttons, links, features sections, or footer.
"Enter App" → sets appLaunched=true → shows Dashboard.
```

---

### 1. Dashboard / Mint Page (`/dashboard`) — First page after Enter App

This is the FIRST page the user sees. Dashboard and Mint are merged into a single unified page.

```
PageHeader: "Dashboard" · badge: chain name
Subtitle: "Mint mUSD, track your portfolio, and monitor protocol health"

4 Key Metric StatCards (sm:2 lg:4):
  • Your Balance       (blue, glow, mUSD balance)
  • Your Staked Earnings (green, smUSD yield earned)
  • Current APY        (purple, smUSD staking yield %)
  • mUSD Supply        (default, % of cap)

┌──────────────────────────── 2-Column Layout ─────────────────────────────┐
│                                                                          │
│  ┌── LEFT (2/5): Mint Widget ──┐  ┌── RIGHT (3/5): Data Panels ──────┐ │
│  │  card-gradient-border        │  │                                   │ │
│  │  ┌ Mint / Redeem tabs ─────┐│  │  ┌── Supply Growth Chart ──────┐ │ │
│  │  │ [Mint]  [Redeem]        ││  │  │  SVG area chart               │ │ │
│  │  └─────────────────────────┘│  │  │  Time range selector:          │ │ │
│  │                              │  │  │  [1w] [1m] [3m] [6m] [1y]     │ │ │
│  │  Collateral Dropdown:        │  │  │  Start/end date labels         │ │ │
│  │  [USDC ▾] [USDT] [DAI]      │  │  │  Current supply value          │ │ │
│  │                              │  │  └────────────────────────────────┘ │ │
│  │  Input:  amount [MAX] token  │  │                                   │ │
│  │            ↓                 │  │  ┌── Recent Activity ────────────┐ │ │
│  │  Output: preview  token      │  │  │  Table: Type | Amount | Block | │ │
│  │                              │  │  │  Mint/Redeem badges, links     │ │ │
│  │  Fee info (rate, fee bps)    │  │  └────────────────────────────────┘ │ │
│  │  [ ═══ Mint mUSD ═══ ]      │  │                                   │ │
│  │  Success/Error alerts        │  │  3 Protocol Health StatCards:     │ │
│  │                              │  │  • Total Backing  (green)         │ │
│  │  2 mini-StatCards:           │  │  • smUSD Staked   (purple)        │ │
│  │  • Remaining Mintable        │  │  • Supply Cap     (utilization %) │ │
│  │  • Available to Redeem       │  │                                   │ │
│  └──────────────────────────────┘  └───────────────────────────────────┘ │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

"How It Works" Explainer Card:
  "Mint mUSD 1:1 against selected collateral, validated in real time by
  attestations on the Canton Network, then stake to begin earning."
```

**Canton variant (`CantonDashboardMint`):**
- Amber/yellow color scheme throughout
- Collateral dropdown replaced by DAML contract selector
- Hero stats show Canton contract counts and totals
- Protocol services status grid (DirectMint, Staking, Oracle, Issuer, Pool)
- Mint/redeem via `exerciseChoice` on DirectMintService DAML template

---

### 2. Stake Page (`/stake`)  — max-w-3xl

```
PageHeader: "Stake & Earn"

2 StatCards (sm:2):
  • Total Staked       (blue, total mUSD staked in vault)
  • Current APY        (emerald, staking yield %)

Stake / Unstake Widget (card-gradient-border):
  ┌─ [➕ Stake mUSD]  [🔄 Unstake smUSD] ───────────────┐
  │                                                        │
  │  2 Balance Cards inside widget (sm:2):                 │
  │  • Your mUSD Balance (blue)                            │
  │  • Your smUSD Balance (purple, sub = ≈ X.XX mUSD)     │
  │                                                        │
  │  Input:  amount  [MAX] [mUSD/smUSD badge]              │
  │              ↓                                         │
  │  Output: preview  [smUSD/mUSD badge]                   │
  │                                                        │
  │  Exchange info (rate, cooldown, fee=None)               │
  │  [ ====== Stake mUSD / Unstake smUSD ============== ] │
  │  Success/Error alerts with Etherscan link               │
  └────────────────────────────────────────────────────────┘

Cooldown Timer (card, only if cooldown active):
  ┌───────────────────────────────────────────────────┐
  │  ⏱ Withdrawal Cooldown      [XX% Complete badge]  │
  │  X.X days remaining  (10-day cooldown period)      │
  │  [███████████████░░░░░░░░░░░]  progress bar        │
  └───────────────────────────────────────────────────┘

"AI Yield Aggregation Engine" Explainer Card:
  Staking distributes generated yield exclusively to mUSD stakers, using our
  AI yield aggregation engine. The AI deliberates across hundreds of protocols
  in Web3 using a proprietary algorithm — Highest Yield, Pool Liquidity,
  Weighted Performance Over Time, Security/Risk Profile, Oracle Stability, Curators.

"Unstaking" Info Card:
  When you unstake, you'll receive your mUSD back plus any accrued yield.
  There is a 10-day cooldown period to process unstaking requests. Your
  tokens continue to earn yield during the cooldown period.
```

**CantonStake variant:**
- Amber/yellow color scheme throughout
- 3 StatCards: Total Staked · Current APY · Minted Points Earned
- mUSD Stake/Unstake widget with DAML contract selector
- **Canton Coin Staking Widget (Canton ONLY):**
  ```
  ┌─── Stake Canton Coin (Boost Pool) ──────────────────────────────────┐
  │  Explainer: "Stake 20% of your mUSD stake in Canton Coin to        │
  │  receive a boosted yield of 2-4% PLUS 60% of all validator rewards  │
  │  PLUS a 10x Minted Points boost"                                    │
  │                                                                      │
  │  3 StatCards:                                                        │
  │  • Boost Pool APY (2-4%)                                             │
  │  • Validator Rewards (60% share)                                     │
  │  • Points Multiplier (10×)                                           │
  │                                                                      │
  │  Canton Coin Stake / Unstake tabs                                    │
  │  Canton Coin Amount input                                            │
  │  [Stake Canton Coin (Coming Soon)] — disabled                        │
  └──────────────────────────────────────────────────────────────────────┘
  ```
- Same AI Yield Aggregation Engine explainer
- Same Unstaking info card

---

### 3. Borrow & Lend Page (`/borrow`)  — max-w-4xl

```
PageHeader: "Borrow & Lend"
Subtitle: "mUSD stakers earn the interest"

Collateral Reference Table (card):
  ┌──────────────────────────────────────────────────────┐
  │  📦 Supported Collateral                              │
  │  ┌────────────┬──────────────┬──────────────────────┐│
  │  │ Asset      │ Max LTV      │ Liquidation Threshold││
  │  │ ETH        │ 75%          │ 80%                  ││
  │  │ WBTC       │ 75%          │ 80%                  ││
  │  │ smUSD      │ 90%          │ 93%                  ││
  │  └────────────┴──────────────┴──────────────────────┘│
  └──────────────────────────────────────────────────────┘

Health Factor & Position Summary (card, only if debt > 0):
  ┌───────────────────────────────────────────────────────┐
  │  Health Factor: X.XX   Status: Healthy / At Risk      │
  │  [████████████████░░░]  (color-coded gauge)            │
  │  Collateral: $XX  ·  Debt: $XX  ·  Utilization: XX%   │
  │  [Close Position]                                      │
  └───────────────────────────────────────────────────────┘

Action Card (card-gradient-border):
  ┌─ [➕ Deposit] [💰 Borrow] [🔄 Repay] [⬆ Withdraw] [⚡ Loop] ────┐
  │                                                                     │
  │  ── Deposit/Borrow/Repay/Withdraw tabs ──                          │
  │  Collateral selector dropdown (deposit/withdraw only):              │
  │     ETH (LTV 75%, Liq 80%)                                         │
  │     WBTC (LTV 75%, Liq 80%)                                        │
  │     smUSD (LTV 90%, Liq 93%)                                       │
  │  Amount input [MAX]                                                 │
  │  [ ====== Deposit / Borrow / Repay / Withdraw ===== ]              │
  │  Success/Error alerts                                               │
  │                                                                     │
  │  ── ⚡ Loop tab ──                                                  │
  │  Leverage Drag Slider: 2x → 3x → 4x → 5x                          │
  │  ┌──────────────────────────────────────────────┐                   │
  │  │  3x   (big display)          Drag to select  │                   │
  │  │  [=====●=============]  range input          │                   │
  │  │   2x      3x      4x      5x                │                   │
  │  └──────────────────────────────────────────────┘                   │
  │  Collateral Amount input                                            │
  │  Position Preview:                                                  │
  │    Total Collateral · Estimated Debt · Loop Iterations · Leverage   │
  │  [ ⚡ Open Xx Loop Position ]                                       │
  │                                                                     │
  │  Active Leverage Position (if exists):                              │
  │    Deposited · Collateral · Outstanding Debt · Leverage             │
  │    [Close Position & Repay Debt] (danger)                           │
  └─────────────────────────────────────────────────────────────────────┘

"How Borrowing Works" — 5 step cards:
  ① Choose Collateral → ② Deposit → ③ Borrow → ④ Repay → ⑤ Stakers Earn

"Loop Explainer" Card (gradient-border):
  Multiply your sMUSD yield in one click.
  Deposit your collateral → automatically borrow mUSD, stake it to sMUSD,
  redeposit, and repeat up to your target leverage. No DEX swaps, no manual steps.
  Your collateral earns leveraged sMUSD staking yield (6-14% base × your loop
  multiplier), while your borrow cost is offset by the yield itself.
  Choose 2x–5x and let the vault handle the rest.

"Looping Strategies" — 2 strategy cards (sm:grid-cols-2):
  ┌─── sMUSD Maxi ─────────────────┐  ┌─── Canton Maxi ────────────────┐
  │  Low-Medium Risk                │  │  Medium Risk                    │
  │  Deposit → Mint → Stake → Loop  │  │  Deposit → Stake → Loop → Boost│
  │  APY table: 2x–5x loops         │  │  APY table: 2x–5x + Boost Pool │
  └──────────────────────────────────┘  └─────────────────────────────────┘
```

**CantonBorrow variant:**
- Amber/yellow color scheme throughout
- Canton-specific collateral reference table:
  ```
  │ Canton Coin │ 65%  │ 75%                  │
  │ smUSD       │ 90%  │ 93%                  │
  ```
- DAML Vault CDP list with contract selection
- Deposit/Borrow/Repay/Withdraw via exerciseChoice on Vault template
- ⚡ Loop tab with 2x–5x slider (Coming Soon on Canton)
- Same "How Borrowing Works" steps (with Canton Coin instead of ETH/WBTC)
- Same Loop Explainer card

---

### 4. Bridge Page (`/bridge`)  — max-w-4xl

```
PageHeader: "Canton Bridge" · badge dynamic "Active" (emerald) / "PAUSED" (warning)

⚠ Paused Alert (alert-error, if bridge paused)

4 StatCards (sm:2 lg:4):
  • Attested Canton Assets   (blue, glow variant, 🏢 icon)
  • Current Supply Cap       (purple, 📊 icon)
  • Remaining Mintable       (green, 💰 icon)
  • Last Attestation         (Xm/h ago, ⏱ icon, sub = timestamp)

Supply Cap & Health Ratio (2-col grid):
  ┌─── Supply Cap Utilization ───┐  ┌─── Bridge Health Ratio ──────┐
  │  (card-gradient-border)       │  │  (card-gradient-border)       │
  │  XX.X% of capacity used      │  │                                │
  │  [██████████████░░░░░]        │  │    1.85  (big, color-coded)   │
  │  Minted: $XX   Available: $XX │  │    "Healthy"                  │
  │                               │  │  [███████████████░░░]         │
  │                               │  │  1.0 ——— 1.5 ——— 2.0+        │
  └───────────────────────────────┘  └──────────────────────────────┘

Bridge Parameters (3-col grid, card):
  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
  │ Collateral Ratio│  │ Required Sigs  │  │ Current Nonce  │
  │     150%        │  │      3         │  │      42        │
  │  Overcollateral │  │ Multi-sig      │  │ Sequence #     │
  └────────────────┘  └────────────────┘  └────────────────┘

Attestation History Table (card):
  ┌───────────────────────────────────────────────────┐
  │  📋 Attestation History — X recent attestations    │
  │  ┌───────┬──────────────┬──────────┬────────┬────┐│
  │  │ Block │ Attestation  │ Canton   │ New    │Nonce││
  │  │ #1234 │ 0x1a2b…3c4d  │ Assets   │ Cap    │    ││
  │  └───────┴──────────────┴──────────┴────────┴────┘│
  │  (empty state: clipboard icon + "No attestations") │
  └───────────────────────────────────────────────────┘

"How the Bridge Works" — 6 step pipeline (3x2 or 6-col):
  ① Observe → ② Verify → ③ Sign → ④ Aggregate → ⑤ Update → ⑥ Mint
  (each with color-coded number circle: blue→purple→brand→emerald→yellow→green)

"Beneficiary Locked Environment (BLE)" Explainer Card:
  Move mUSD and sMUSD between Ethereum and Canton. Your yield never stops.
  Powered by Minted's proprietary BLE — a multi-sig attestation system where
  institutional validators verify every cross-chain transfer. No relayers,
  no optimistic windows. Every bridge action is cryptographically attested,
  validating assets on Canton, supply-cap enforced, and settled with finality.
```

---

### 5. Points Page (`/points`)

```
PageHeader: "Points Program" · "Earn points for using the protocol. Points convert to MNTD token airdrop." · badge: season name

Season Progress Bar (card):
  ┌───────────────────────────────────────────────────┐
  │  Season 1 — Genesis                               │
  │  2x multiplier · 45 days remaining                │
  │  [██████████████░░░░░░░░░░░░] 58% Complete        │
  │  ● Season 1 (active) · ○ Season 2 · ○ Season 3   │
  └───────────────────────────────────────────────────┘

Tab Nav: [Overview] [Leaderboard] [Calculator]

OVERVIEW TAB:
  Your Points (4 StatCards):
    • Total Points   (glow, blue)
    • Global Rank    (purple)
    • Current Season (default)
    • Seasons Active (green)

  Points Breakdown (card): per-action breakdown by season

  How It Works (card):
    "Your Points = USD Value × Multiplier × Hours"

  3 Seasons Multiplier Table:
    ┌──────────────┬──────────┬───────┬──────────┬────────┐
    │ Season       │ Boost    │ sMUSD │ Collat.  │ Borrow │
    │ 1 — Genesis  │ 10× 🔥   │ 4×    │ 3×       │ 2×     │
    │ 2 — Growth   │ 6×       │ 2.5×  │ 2×       │ 1.5×   │
    │ 3 — Maturity │ 4×       │ 1.5×  │ 1×       │ 1×     │
    └──────────────┴──────────┴───────┴──────────┴────────┘

  What Earns Points (2-col grid):
    Canton (higher multipliers): Stake mUSD, Deposit sMUSD/CTN, Borrow, Boost Pool
    Ethereum: Hold sMUSD, Deposit ETH/WBTC/sMUSD, Borrow, Leverage Vault

  Points APY by TVL (table):
    ┌──────────┬───────────────┬──────────────┬───────────────┐
    │ TVL      │ Boost Pool 🔥 │ sMUSD (CTN)  │ sMUSD (ETH)   │
    │ $5M      │ 354%          │ 142%         │ 106%          │
    │ $10M     │ 177%          │ 71%          │ 53%           │
    │ $25M     │ 71%           │ 28%          │ 21%           │
    │ $50M     │ 35%           │ 14%          │ 11%           │
    └──────────┴───────────────┴──────────────┴───────────────┘

  Maximize Your Points (4 tips):
    ① Get in early  ② Use Canton  ③ Loop your sMUSD  ④ Deposit $CC in Boost Pool

  Airdrop Section:
    Points → $MINT Tokens at TGE. Proportional to total points share.

LEADERBOARD TAB:
  Top 25 table: Rank · Address · Points (highlights user's own row)

CALCULATOR TAB:
  Implied APY (3 StatCards): APY · Token Price · Total Airdrop Value
  Scenarios Table: deposit · est. points · allocation · value · APY
  Multiplier Schedule: per-action cards with ETH/CTN badges
```

---

### 6. Admin Page (`/admin`)  — max-w-4xl

```
Tab bar: [mUSD] [DirectMint] [Treasury] [Bridge] [Borrow] [Oracle]

Each section shows:
  • Current on-chain values (read from contracts)
  • Input fields to update parameters
  • TxButton to submit transactions
  • Success/Error feedback

Sections:
  mUSD:       Supply cap, blacklist address
  DirectMint: Mint/redeem fees, fee recipient, min/max amounts, pause, collect fees
  Treasury:   Add/remove strategy, deploy/withdraw funds, max deployment BPS
  Bridge:     Min signatures, collateral ratio, emergency cap, pause
  Borrow:     Interest rate, min debt
  Oracle:     Set price feed (token, feed address, stale threshold, decimals)
```

---

## Component Hierarchy

```
LandingPage (pre-app gate, shown when appLaunched=false)
├── THREE.js Scene (particles, orb, rings, neural lines)
├── Navbar (logo + "Enter App" button only)
├── Headline ("The currency for the Web3 Ownership Economy")
└── 4 Global Stat Cards (mUSD Supply, APY, Users, Canton Attestation Value)

Layout (shown when appLaunched=true)
├── Navbar
│   ├── Logo (Minted Protocol)
│   ├── NavItems × 7 (desktop)
│   ├── ChainToggle (ETH ⟷ Canton)
│   ├── Wallet Button / Connect Button
│   └── Mobile Menu (hamburger → slide-down)
│
├── Main Content (page router via useState)
│   ├── DashboardPage
│   │   ├── PageHeader
│   │   ├── Tab Toggle (Portfolio / Protocol)
│   │   ├── StatCard × 4
│   │   ├── Net Worth Card (gradient-border)
│   │   └── Position / Metrics grids
│   │
│   ├── MintPage
│   │   ├── PageHeader
│   │   ├── StatCard × 4
│   │   ├── Balance Cards × 2
│   │   ├── Action Card (mint/redeem tabs)
│   │   │   ├── ChainSelector (cross-chain)
│   │   │   ├── AmountInput + MAX + TokenBadge
│   │   │   ├── Arrow Separator
│   │   │   ├── OutputPreview
│   │   │   ├── ExchangeInfo
│   │   │   ├── TxButton
│   │   │   └── AlertStatus
│   │   ├── HowItWorks Explainer Card
│   │   └── Info Cards (Remaining Mintable + Available for Redemption)
│   │
│   ├── StakePage
│   │   ├── 2 StatCards (Total Staked, Current APY)
│   │   ├── Stake/Unstake Widget (card-gradient-border)
│   │   │   ├── 2 Balance Cards (mUSD, smUSD)
│   │   │   ├── AmountInput + MAX + TokenBadge
│   │   │   ├── Arrow Separator
│   │   │   ├── OutputPreview
│   │   │   ├── ExchangeInfo
│   │   │   ├── TxButton
│   │   │   └── AlertStatus
│   │   ├── CooldownTimer (10-day cooldown, progress bar)
│   │   ├── AI Yield Aggregation Explainer Card
│   │   └── Unstaking Info Card
│   │
│   │   Canton variant adds:
│   │   ├── 3rd StatCard (Minted Points Earned)
│   │   ├── Canton Coin Boost Pool Widget
│   │   │   ├── Explainer text
│   │   │   ├── 3 StatCards (Boost APY, Validator Rewards, Points 10×)
│   │   │   ├── Stake/Unstake tabs (Coming Soon)
│   │   │   └── Amount Input (disabled)
│   │
│   ├── BorrowPage
│   │   ├── Collateral Reference Table (ETH/WBTC/smUSD with LTV/Liq data)
│   │   ├── HealthFactor + Position Summary (conditional on debt > 0)
│   │   ├── Action Card (deposit/borrow/repay/withdraw/loop tabs)
│   │   │   ├── CollateralSelector dropdown (deposit/withdraw)
│   │   │   ├── AmountInput + MAX
│   │   │   ├── ⚡ Loop tab:
│   │   │   │   ├── Leverage Drag Slider (2x–5x range input)
│   │   │   │   ├── Collateral Amount input
│   │   │   │   ├── Position Preview (collateral/debt/loops/leverage)
│   │   │   │   └── Open Loop Position button
│   │   │   ├── Active Leverage Position display + Close button
│   │   │   ├── TxButton
│   │   │   └── AlertStatus
│   │   ├── HowItWorks × 5 (Choose→Deposit→Borrow→Repay→Stakers Earn)
│   │   ├── Loop Explainer Card
│   │   └── LoopingStrategies × 2 (sMUSD Maxi + Canton Maxi)
│   │
│   │   Canton variant:
│   │   ├── Canton collateral table (Canton Coin 65/75, smUSD 90/93)
│   │   ├── DAML Vault CDP list with contract selection
│   │   ├── Vault actions via exerciseChoice
│   │   └── ⚡ Loop tab (Coming Soon on Canton)
│   │
│   ├── BridgePage
│   │   ├── PageHeader (badge: Active/PAUSED)
│   │   ├── PausedAlert (conditional)
│   │   ├── StatCard × 4
│   │   ├── SupplyCapUtilization + HealthRatio (gradient-border, 2-col)
│   │   ├── BridgeParameters (3-col grid)
│   │   ├── AttestationHistory (table or empty state)
│   │   ├── HowItWorks × 6 (pipeline)
│   │   └── BLE Explainer Card
│   │
│   ├── PointsPage
│   │   ├── PageHeader
│   │   ├── Season Progress Bar
│   │   ├── Tab Nav (Overview / Leaderboard / Calculator)
│   │   ├── Overview Tab
│   │   │   ├── Your Points (StatCard × 4)
│   │   │   ├── Points Breakdown (per-action)
│   │   │   ├── How It Works (formula card)
│   │   │   ├── 3 Seasons Multiplier Table
│   │   │   ├── What Earns Points (Canton vs Ethereum)
│   │   │   ├── Points APY by TVL Table
│   │   │   ├── Maximize Your Points (4 tips)
│   │   │   └── Airdrop Info Card
│   │   ├── Leaderboard Tab (top-25 table)
│   │   └── Calculator Tab
│   │       ├── Implied APY (StatCard × 3)
│   │       ├── Scenarios Table
│   │       └── Multiplier Schedule
│   │
│   └── AdminPage
│       ├── Section Tab Bar (6 tabs)
│       └── Section Forms (inputs + TxButtons)
│
└── Footer
    ├── Status indicator (green dot)
    ├── Links (Docs · GitHub · Discord)
    └── Copyright
```

---

## Responsive Breakpoints

| Breakpoint | Nav        | StatCards      | Feature Cards   | Action Card  |
|------------|------------|----------------|-----------------|--------------|
| `< sm`     | Mobile menu| 1 column       | 1 column        | Full width   |
| `sm`       | Mobile menu| 2 columns      | 1 column        | Full width   |
| `lg`       | Desktop nav| 4 columns      | 2 columns       | Full width   |

---

## Key Interactions

1. **Wallet Connect** — Click "Connect Wallet" → MetaMask popup → address shown with green dot
2. **Chain Toggle** — Click pill → swaps all pages between Ethereum and Canton variants
3. **Tab Switching** — Click tab → active underline animates, form resets, amount clears
4. **MAX Button** — Fills input with full wallet balance for selected token
5. **Amount Input** — Focus triggers glow border; live preview updates with 300ms debounce
6. **TxButton** — Click → simulate tx → send tx → loading spinner → success alert with Etherscan link / error alert
7. **Approve Flow** — If allowance insufficient, auto-approve before main tx (sequential)
8. **Page Navigation** — `useState("dashboard")` in `index.tsx`, no URL routing (SPA)

---

## File Map

```
frontend/src/
├── pages/
│   ├── index.tsx            — SPA router (useState page switch)
│   ├── _app.tsx             — Next.js app wrapper
│   ├── _document.tsx        — HTML document
│   ├── DashboardPage.tsx    — Protocol + portfolio dashboard
│   ├── MintPage.tsx         — USDC ↔ mUSD mint/redeem
│   ├── StakePage.tsx        — mUSD ↔ smUSD stake/unstake
│   ├── BorrowPage.tsx       — Collateral deposit, borrow, repay, withdraw + leverage looping
│   ├── BridgePage.tsx       — Canton attestation monitoring
│   ├── AdminPage.tsx        — Protocol admin panel
│   ├── PointsPage.tsx       — Points program, seasons, leaderboard, APY calculator
│   ├── LeveragePage.tsx     — (standalone leverage, code now merged into BorrowPage)
│   └── LiquidationsPage.tsx — (unused, not in nav)
│
├── components/
│   ├── LandingPage.tsx      — Pre-app gate: THREE.js scene, headline, stats, Enter App
│   ├── Layout.tsx           — Shell: bg, navbar, main, footer
│   ├── Navbar.tsx           — Top nav with 7 items + wallet + chain toggle
│   ├── ChainToggle.tsx      — ETH ⟷ Canton pill switch
│   ├── StatCard.tsx         — Metric card (color, icon, trend, sub, variant)
│   ├── PageHeader.tsx       — Title + subtitle + badge
│   ├── TxButton.tsx         — Transaction button with loading state
│   └── canton/              — Canton-chain page equivalents
│       ├── CantonDashboard.tsx
│       ├── CantonMint.tsx
│       ├── CantonStake.tsx
│       ├── CantonBorrow.tsx
│       ├── CantonBridge.tsx
│       └── CantonAdmin.tsx
│
├── hooks/
│   ├── useWalletConnect.ts  — WalletConnect / MetaMask connection
│   ├── useWCContracts.ts    — Contract instances via WalletConnect signer
│   ├── useContract.ts       — Legacy contract hook
│   ├── useWallet.ts         — Legacy MetaMask hook
│   ├── useTx.ts             — Tx send with simulation, loading/error/success
│   ├── useChain.ts          — Chain state (ethereum / canton toggle)
│   └── useCanton.ts         — Canton/DAML integration
│
├── lib/
│   ├── config.ts            — Contract addresses, decimals, validation
│   └── format.ts            — formatUSD, formatToken, formatBps, formatHealthFactor, shortenAddress, formatTimestamp
│
├── abis/                    — Contract ABI TypeScript exports
│   ├── MUSD.ts, SMUSD.ts, DirectMint.ts, Treasury.ts
│   ├── CollateralVault.ts, BorrowModule.ts, LiquidationEngine.ts
│   ├── BLEBridgeV9.ts, PriceOracle.ts, ERC20.ts
│
└── styles/
    └── globals.css          — Full Tailwind design system (350 lines)
```
