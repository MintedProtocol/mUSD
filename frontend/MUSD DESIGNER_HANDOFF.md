# mUSD Protocol — Frontend Handoff v2

> Section-by-section breakdown of the mUSD dApp.
> Single-page application. Two-chain architecture (Ethereum + Canton).
>
> **v2 — Feb 2026:** Updated to reflect actual coded state. Sections marked [LIVE] are implemented and wired. Sections marked [SPEC] are design targets not yet built.

---

## Product Context

- **Product Name:** mUSD
- **Tagline:** "The Institutional Ownership Reserve Currency, powered by Canton Network"
- **Tokens:** mUSD (stablecoin), smUSD (staked mUSD), $MINT (governance — future TGE)
- **Chains:** Ethereum (primary) and Canton Network (institutional DeFi chain)

---

## Site Architecture

The app has two layers:

1. **Landing Page** — a cinematic pre-app gate. Full viewport. No scroll. One CTA. [SPEC — stub exists]
2. **Main App** — entered via "Enter App" button. 7 pages, top navbar, SPA routing. [LIVE]

Within the main app, every page has an **Ethereum variant** and a **Canton variant**. A toggle in the navbar switches between them. The two chains must be visually distinguishable.

---

## Global Shell [LIVE]

### Navbar (sticky, always visible in the main app)

```
┌──────────┬───────────────────────────────────────────────────────┬────────────────────┐
│  Logo    │  Dashboard · Mint · Stake · Borrow & Lend ·           │  [ETH ⟷ Canton]   │
│  Minted  │  Bridge · Points · Admin                              │  [Connect Wallet]  │
│  Protocol│                                                        │                    │
└──────────┴───────────────────────────────────────────────────────┴────────────────────┘
```

**Elements:**
- **Logo:** Left-aligned. "Minted Protocol" wordmark. Clicking returns to Dashboard.
- **Nav Tabs:** 7 horizontal items. Active tab has an indicator.
  - Dashboard, Mint, Stake, Borrow & Lend, Bridge, Points, Admin
- **Chain Toggle:** Pill-style toggle between "Ethereum" and "Canton". Entire app swaps chain context.
- **Connect Wallet:** MetaMask/WalletConnect button. Connected state shows truncated address + green dot. Canton shows Loop party ID.

**Mobile (< lg breakpoint):** Nav tabs collapse into hamburger menu → slide-down overlay with full-width nav items.

### Footer

```
● All systems operational          Docs · GitHub · Discord          © 2026 Minted
```

- Left: operational status dot + text
- Center/Right: external links
- Far right: copyright

---

## Navigation Items [LIVE]

| Key         | Label          | Icon    | Page Component (ETH)     | Page Component (Canton)    | Status |
|-------------|----------------|---------|--------------------------|----------------------------|--------|
| `dashboard` | Dashboard      | Home    | `DashboardPage`          | `CantonDashboard`          | LIVE   |
| `mint`      | Mint           | Dollar  | `MintPage`               | `CantonMint`               | LIVE   |
| `stake`     | Stake          | Chart   | `StakePage`              | `CantonStake`              | LIVE   |
| `borrow`    | Borrow & Lend  | Building| `BorrowPage`             | `CantonBorrow`             | LIVE   |
| `bridge`    | Bridge         | Arrows  | `BridgePage`             | `CantonBridge`             | LIVE   |
| `points`    | Points         | Star    | `PointsPage`             | `PointsPage`               | LIVE   |
| `admin`     | Admin          | Gear    | `AdminPage`              | `CantonAdmin`              | LIVE   |

---

## Page Layouts

### 0. Landing Page (pre-app gate) — `LandingPage.tsx` [SPEC]

Shown before the user enters the app. Full-screen, no scrollable content below.

**Current state:** Stub exists with headline + 2 CTA buttons + 3 feature cards. THREE.js scene, stat cards, and minimal navbar not yet implemented.

```
┌──────────────────────────────────────────────────────────────────┐
│  THREE.js Animated Scene (full viewport, behind all content)     │
│  • Particle system                                                │
│  • Neural-network connection lines between nearby particles      │
│  • Mouse-follow camera (smooth lerp)                             │
│  • Overlay for text legibility                                    │
├──────────────────────────────────────────────────────────────────┤
│  NAV BAR (z-20, minimal)                                         │
│  ┌──────────┐                                    ┌─────────────┐│
│  │ Logo     │                                    │ [Enter App] ││
│  │ Minted   │                                    │             ││
│  │ Protocol │                                    │  button      ││
│  └──────────┘                                    └─────────────┘│
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│          "The currency for the"                                  │
│          "Web3 Ownership Economy"                                │
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

### 1. Dashboard Page (`/dashboard`) [LIVE]

**Purpose:** Home base. Portfolio overview with quick actions and embedded referral widget. Has 3 tab views: Mint, Portfolio, Protocol Stats.

**Subtitle:** "Mint mUSD, track your portfolio, and monitor protocol health"

```
PageHeader: "Dashboard" · badge: chain name

3-Tab Toggle: [Mint] [Portfolio] [Protocol Stats]

═══ MINT TAB ═══
  Embeds full MintPage component

═══ PORTFOLIO TAB ═══ [LIVE]
  4 StatCards (sm:2 lg:4):
    • mUSD Balance
    • smUSD Balance
    • Staking Yield
    • Borrow Health

  Section: "Your Positions"
    Position cards showing active stakes, borrows, collateral

  Section: "Quick Actions"
    4 ActionCards → navigate to Mint / Stake / Borrow / Bridge

  ┌── Referral Widget (compact) ─────────────────────────────────┐  [LIVE]
  │                                                               │
  │  ┌ Header ────────────────────────────────────────────────┐  │
  │  │  🔶 Referral Program    [X.Xx BOOST badge]              │  │
  │  │  "Earn boosted points for every friend who adds TVL"    │  │
  │  └─────────────────────────────────────────────────────────┘  │
  │                                                               │
  │  3 Quick Stats:                                               │
  │  ┌───────────┐ ┌───────────┐ ┌───────────┐                  │
  │  │ Referees  │ │ Referred  │ │ Bonus Pts │                  │
  │  │    12     │ │  TVL $45K │ │   2,340   │                  │
  │  └───────────┘ └───────────┘ └───────────┘                  │
  │                                                               │
  │  Next Tier Progress Bar:                                      │
  │  [████████████░░░░░░░] 1.5x → 2.0x at $100K                 │
  │                                                               │
  │  Your Referral Links:  [+ Generate Code (2/5)]               │
  │  ┌ MNTD-ABC123  [Copy Link] ┐                               │
  │  ┌ MNTD-DEF456  [Copy Link] ┐                               │
  │                                                               │
  │  Have a referral code?                                        │
  │  [ MNTD-XXXXXX ] [Apply]                                     │
  │                                                               │
  │  ▸ Multiplier Tiers (collapsible table)                      │
  └───────────────────────────────────────────────────────────────┘

═══ PROTOCOL STATS TAB ═══
  Protocol-wide metrics, supply data, treasury backing, bridge health
```

### Canton Variant (`CantonDashboard`)
- Collateral dropdown replaced by DAML contract selector
- Stat cards show Canton contract counts and totals
- Protocol services status grid (DirectMint, Staking, Oracle, Issuer, Pool)

---

### 2. Mint Page (`/mint`) [LIVE]

**Purpose:** Convert USDC/USDT/DAI to mUSD at 1:1 (minus fees). Cross-chain deposit support.

```
PageHeader: "Mint & Redeem mUSD"

4 StatCards (sm:2 lg:4):
  • mUSD Balance
  • USDC Balance
  • Exchange Rate ("1:1")
  • Supply Cap Usage (%)

Mint/Redeem Widget (prominent card):
  ┌─ [Mint]  [Redeem] ───────────────────────────────────────────┐
  │                                                               │
  │  ChainSelector: [Ethereum ▾] [Base] [Arbitrum] [Solana]     │
  │  (cross-chain deposit: shows USDC balance per chain)          │
  │                                                               │
  │  Input:  amount  [MAX]  [USDC badge]                         │
  │              ↓                                                │
  │  Output: preview  [mUSD badge]                                │
  │                                                               │
  │  Fee info (rate bps, net amount)                              │
  │  [ ═══════ Mint mUSD ═══════ ]                               │
  │  Success/Error alerts with Etherscan link                     │
  │                                                               │
  │  2 mini-StatCards:                                            │
  │  • Remaining Mintable                                         │
  │  • Available to Redeem                                        │
  └───────────────────────────────────────────────────────────────┘
```

---

### 3. Stake Page (`/stake`) [LIVE]

**Purpose:** Stake mUSD → smUSD for yield. Two pool tabs: smUSD vault and ETH Pool (smUSD-E).

```
PageHeader: "Stake & Earn"

2 StatCards (sm:2):
  • Total Staked       (total mUSD in vault)
  • Current APY        (staking yield %)

Pool Tabs: [smUSD Vault] [ETH Pool (smUSD-E)]

═══ smUSD Vault Tab ═══
  Stake / Unstake Widget (prominent card):
    ┌─ [➕ Stake mUSD]  [🔄 Unstake smUSD] ───────────────┐
    │  2 Balance Cards (mUSD, smUSD with ≈ mUSD equivalent) │
    │  Input → Output preview → Exchange info → TxButton     │
    └────────────────────────────────────────────────────────┘

═══ ETH Pool Tab ═══
  Deposit ETH/USDC/USDT with time-lock boost multipliers (1.0x-2.0x)

Cooldown Timer (card, only if cooldown active):
  [███████████████░░░░░░░░░░░] X.X days remaining

AI Yield Aggregation Engine Explainer Card
Unstaking Info Card

Canton variant adds:
  • 3rd StatCard (Minted Points Earned)
  • Canton Coin Boost Pool Widget (Coming Soon)
```

---

### 4. Borrow & Lend Page (`/borrow`) [LIVE]

**Purpose:** Multi-function lending. Deposit collateral, borrow mUSD, leverage loop 2x-5x.

**Subtitle:** "mUSD stakers earn the interest"

```
PageHeader: "Borrow & Lend"

Collateral Reference Table:
  │ ETH   │ 75% LTV │ 80% Liq │
  │ WBTC  │ 75% LTV │ 80% Liq │
  │ smUSD │ 90% LTV │ 93% Liq │

Health Factor & Position Summary (conditional on debt > 0):
  Health Factor: X.XX  Status: Healthy / At Risk
  [████████████████░░░] gauge
  Collateral: $XX · Debt: $XX · Utilization: XX%

Action Card (prominent card):
  ┌─ [➕ Deposit] [💰 Borrow] [🔄 Repay] [⬆ Withdraw] [⚡ Loop] ────┐
  │  Deposit/Borrow/Repay/Withdraw: Collateral selector + amount      │
  │                                                                     │
  │  ⚡ Loop tab:                                                       │
  │  Leverage Slider: 2x → 3x → 4x → 5x                              │
  │  Position Preview: Collateral · Debt · Loops · Leverage            │
  │  [ ⚡ Open Xx Loop Position ]                                      │
  │  Active Position display + [Close Position & Repay Debt]           │
  └─────────────────────────────────────────────────────────────────────┘

How Borrowing Works — 5 steps
Loop Explainer Card
Looping Strategies — sMUSD Maxi + Canton Maxi (2 cards side by side)
```

Canton variant: Canton Coin (65/75) + smUSD (90/93), DAML vault, Loop Coming Soon.

---

### 5. Bridge Page (`/bridge`) [LIVE]

**Purpose:** Canton BLE bridge monitoring + bridge-out panel.

```
PageHeader: "Canton Bridge" · badge: "Active" / "PAUSED"

⚠ Paused Alert (if bridge paused)

4 StatCards:
  • Attested Canton Assets · Supply Cap · Remaining Mintable · Last Attestation

Supply Cap & Health Ratio (2-col grid):
  ┌─── Supply Cap Utilization ───┐  ┌─── Bridge Health Ratio ──────┐
  │  XX.X% used                   │  │  1.85  "Healthy"              │
  │  [██████████████░░░░░]        │  │  [███████████████░░░]         │
  └───────────────────────────────┘  └──────────────────────────────┘

Bridge Parameters (3-col): Collateral Ratio · Required Sigs · Current Nonce

Attestation History Table (recent 20 on-chain events)

BridgeOutPanel: Send mUSD/USDC from Ethereum to Canton

How the Bridge Works — 6 step pipeline:
  ① Observe → ② Verify → ③ Sign → ④ Aggregate → ⑤ Update → ⑥ Mint

BLE Explainer Card
```

---

### 6. Points & Referrals Page (`/points`) [LIVE]

**Purpose:** Points program + referral system. Users track points, manage referral codes, view leaderboard.

**Current implementation has 3 tabs: Overview, My Referrals, Leaderboard.**
**Spec targets (not yet built): Season progress bar, Calculator tab, APY-by-TVL tables.**

```
PageHeader: "Points & Referrals"
Subtitle: "Earn points by minting, staking, borrowing, and referring friends.
           Referred TVL unlocks boosted multipliers."

4 StatCards (sm:2 lg:4):                                          [LIVE]
  • Total Points
  • Rank
  • Referrals (from referral dashboard)
  • Referral Boost (multiplier e.g. "1.5x")

Season Progress Bar (card):                                       [SPEC]
  ┌───────────────────────────────────────────────────┐
  │  Season 1 — Genesis                               │
  │  2x multiplier · 45 days remaining                │
  │  [██████████████░░░░░░░░░░░░] 58% Complete        │
  │  ● Season 1 (active) · ○ Season 2 · ○ Season 3   │
  └───────────────────────────────────────────────────┘

Tab Nav: [Overview] [My Referrals] [Leaderboard]              [LIVE]

═══ OVERVIEW TAB ═══ [LIVE]
  Points Breakdown (card):
    Per-action rates with icons:
    ┌──────────────────────────────────────────────────┐
    │  💵 mUSD Holding      1x / $ / day               │
    │  🔒 smUSD Staking     3x / $ / day               │
    │  🏦 Borrowing         2x / $ / day               │
    │  💎 LP Positions      5x / $ / day               │
    │  🌉 Canton Bridge     1.5x multiplier            │
    │  🤝 Referral Bonus    Up to 3x on referred TVL   │
    └──────────────────────────────────────────────────┘

  ReferralWidget (compact card, same as Dashboard):     [LIVE]
    Generate codes, copy links, apply codes, stats, tier progress

  [SPEC — not yet built:]
  • How It Works formula card ("Points = USD Value × Multiplier × Hours")
  • 3 Seasons Multiplier Table
  • What Earns Points (Canton vs Ethereum 2-col)
  • Points APY by TVL Table
  • Maximize Your Points tips
  • Airdrop Info Card

═══ MY REFERRALS TAB ═══ [LIVE] — ReferralTracker component
  4 StatCards: Referees · Referred TVL · Bonus Points · Multiplier

  Multiplier Progress (card):
    [████████████████░░░░░] with tier markers
    Tier table: Tier # · Min TVL · Multiplier · Status (CURRENT/Unlocked/Locked)

  Referee List (card):
    Numbered list of referee addresses with Etherscan links

  Your Referral Chain (card, if referred):
    "Referred by 0x1234…5678 — They earn 10% bonus on your points"

  Global Stats: Protocol Referrers · Total Links

═══ LEADERBOARD TAB ═══ [LIVE] — ReferralLeaderboard component
  Time range filter: [All Time] [30D] [7D]

  Your Position (sticky banner):
    #Rank · Referees · TVL · Multiplier · Bonus Points

  Top 50 Table:
    ┌──────┬──────────────┬──────────┬──────────┬──────┬───────────┐
    │ Rank │ Referrer     │ Referees │ Ref. TVL │ Mult │ Bonus Pts │
    │ 🥇 1 │ 0x1a2b…3c4d │    24    │ $1.2M    │ 3.0x │ 45,000    │
    │ 🥈 2 │ 0x5e6f…7g8h │    18    │ $890K    │ 2.5x │ 32,100    │
    │ 🥉 3 │ 0x9i0j…1k2l │    15    │ $650K    │ 2.0x │ 24,500    │
    │   4  │ 0xmnop…qrst │    12    │ ...      │ ...  │ ...       │
    └──────┴──────────────┴──────────┴──────────┴──────┴───────────┘
    Medal icons for top 3, "YOU" badge on user's row

  Empty state: clipboard icon + "No referrers yet — be the first!"

═══ CALCULATOR TAB ═══ [SPEC — not yet built]
  Implied APY (3 StatCards): APY · Token Price · Total Airdrop Value
  Scenarios Table: deposit · est. points · allocation · value · APY
  Multiplier Schedule: per-action cards with ETH/CTN badges
```

---

### 7. Admin Page (`/admin`) [LIVE]

**Purpose:** Internal operations console. Wallet-gated to admin role holders.

Collapsible accordion sections, confirmation modals, decoded revert reasons.

```
Tab bar: [Emergency] [mUSD] [DirectMint] [Treasury] [Vaults] [Bridge] [Borrow] [Oracle]

Each section:
  • Current on-chain values (read from contracts)
  • Input fields to update parameters
  • TxButton to submit transactions
  • Success/Error feedback

Emergency:   Global pause/unpause, guardian role checks
mUSD:        Supply cap, blacklist address
DirectMint:  Mint/redeem fees, fee recipient, min/max amounts, pause, collect fees
Treasury:    Add/remove strategy, deploy/withdraw funds, max deployment BPS
             Embeds: YieldScanner + AIYieldOptimizer components
Vaults:      Rebalance, pause, deploy USDC
Bridge:      Min signatures, collateral ratio, emergency cap, pause
Borrow:      Interest rate, min debt
Oracle:      Set price feed (token, feed address, stale threshold, decimals)
```

---

## Referral System Components [LIVE]

The referral system spans three dedicated components plus an on-chain `ReferralRegistry` contract.

### ReferralWidget (compact card)
**Used on:** DashboardPage (Portfolio tab), PointsPage (Overview tab)

- Generate referral codes (up to 5 per user, format: `MNTD-XXXXXX`)
- Copy referral link to clipboard (`?ref=MNTD-XXXXXX` query param)
- Apply someone else's referral code
- Quick stats row: Referees | Referred TVL | Bonus Points
- Multiplier tier progress bar (current → next tier)
- Collapsible tier table
- Auto-detect `?ref=` query parameter on page load

### ReferralTracker (full panel)
**Used on:** PointsPage (My Referrals tab)

- Header stats: 4 StatCards (Referees, Referred TVL, Bonus Points, Multiplier)
- Multiplier progress visualization with tier markers
- Full tier breakdown table with CURRENT/Unlocked/Locked statuses
- Numbered referee list with Etherscan links
- Your Referral Chain (if referred by someone)
- Global protocol stats (total referrers, total links)

### ReferralLeaderboard (ranking table)
**Used on:** PointsPage (Leaderboard tab)

- Top 50 referrers by referred TVL (from on-chain `ReferralLinked` events)
- Distinction for top 3
- Time range filter (All Time, 30D, 7D)
- Sticky "Your Position" banner
- "YOU" badge on user's own row
- Batch-fetched from `referrerStats()` and `getMultiplier()` contract calls

---

## Shared Component Library

| Component | Used On | Status | Notes |
|-----------|---------|--------|-------|
| **StatCard** | Every page | LIVE | Metric card with icon, value, label, optional sub-text and trend indicator. |
| **PageHeader** | Every page | LIVE | Title + subtitle + optional badge |
| **TxButton** | Mint, Stake, Borrow, Admin | LIVE | Action button. States: default → loading → success → error. Variants: primary, secondary, danger, success. Sizes: default, sm. |
| **Section** | Dashboard | LIVE | Content section wrapper with title, subtitle, optional icon |
| **ChainToggle** | Navbar (global) | LIVE | Pill toggle: Ethereum ⟷ Canton |
| **ChainSelector** | MintPage | LIVE | Multi-chain dropdown (Base, Arbitrum, Solana, Ethereum) with USDC balance per chain |
| **WalletConnector** | All pages (fallback) | LIVE | Large card prompting wallet connection |
| **BridgeOutPanel** | BridgePage | LIVE | Transfer mUSD/USDC from Ethereum → Canton |
| **ReferralWidget** | Dashboard, Points | LIVE | Compact referral card (codes, stats, tier progress) |
| **ReferralTracker** | Points | LIVE | Full referral tracking panel |
| **ReferralLeaderboard** | Points | LIVE | Top-50 referral ranking table |
| **LeverageSlider** | BorrowPage | LIVE | 2x-5x drag slider with risk visualization |
| **YieldScanner** | AdminPage | LIVE | Live market yield tracker for strategies |
| **AIYieldOptimizer** | AdminPage | LIVE | AI-powered allocation recommendations |
| **PendingDepositsList** | Deposit flows | LIVE | Pending cross-chain deposit tracker |
| **OnboardingFlow** | First-time users | LIVE | Step-by-step protocol introduction |
| **ErrorBoundary** | App root | LIVE | React error boundary with retry |
| **LandingPage** | Pre-app gate | STUB | Headline + CTAs, THREE.js not yet built |

---

## Responsive Behavior

| Breakpoint | Nav | Stat Cards | Feature Cards | Action Card |
|------------|-----|-----------|--------------|-------------|
| Mobile (< sm) | Hamburger menu | 1 column | 1 column | Full width |
| Tablet (sm) | Hamburger menu | 2 columns | 1 column | Full width |
| Desktop (lg+) | Horizontal nav (7 items) | 4 columns | 2 columns | Full width |

---

## Key Interactions

| # | Interaction | Behavior |
|---|------------|----------|
| 1 | **Connect Wallet** | Click → MetaMask/WalletConnect popup → address shown with green dot + ENS name |
| 2 | **Chain Toggle** | Click pill → entire app swaps between Ethereum and Canton page variants |
| 3 | **Tab Switching** | Click tab → active underline animates (chain-colored), form resets |
| 4 | **MAX Button** | Fills input with user's full wallet balance for selected token |
| 5 | **Amount Input** | Focus triggers border highlight; live output preview with 300ms debounce |
| 6 | **TxButton** | Simulate tx → send tx → loading spinner → success alert with explorer link / error |
| 7 | **Approve Flow** | If ERC-20 allowance insufficient, auto-approve before main tx (sequential) |
| 8 | **Leverage Slider** | Drag 2x–5x → live position preview recalculates |
| 9 | **Referral Code** | Generate → auto-copy link. Apply → on-chain `linkReferral()` tx |
| 10 | **Page Navigation** | `useState("dashboard")` in `index.tsx`, no URL routing (SPA) |

---

## Component Hierarchy [LIVE]

```
LandingPage (pre-app gate, shown when appLaunched=false) [STUB]
├── Headline ("Minted mUSD" + subtitle)
├── 2 CTA Buttons (Start Minting, Stake mUSD)
└── 3 Feature Cards (Cross-Chain, Yield Bearing, DeFi Native)

Layout (shown when appLaunched=true)
├── Navbar
│   ├── Logo (Minted Protocol → navigate to dashboard)
│   ├── NavItems × 7 (Dashboard, Mint, Stake, Borrow & Lend, Bridge, Points, Admin)
│   ├── ChainToggle (ETH ⟷ Canton)
│   ├── Wallet Button / Connect Button / Canton Party Display
│   └── Mobile Menu (hamburger → slide-down)
│
├── Main Content (page router via useState)
│   ├── DashboardPage
│   │   ├── PageHeader
│   │   ├── 3-Tab Toggle (Mint / Portfolio / Protocol Stats)
│   │   ├── MintPage (embedded in Mint tab)
│   │   ├── Portfolio Tab
│   │   │   ├── StatCard × 4 (Balance, Staked, Yield, Health)
│   │   │   ├── Section: Your Positions
│   │   │   ├── Section: Quick Actions (4 ActionCards)
│   │   │   └── ReferralWidget (compact card)
│   │   └── Protocol Stats Tab
│   │       └── Protocol-wide metrics
│   │
│   ├── MintPage
│   │   ├── PageHeader
│   │   ├── StatCard × 4
│   │   ├── ChainSelector (cross-chain deposits)
│   │   ├── Mint/Redeem Widget
│   │   │   ├── Tab Toggle (Mint / Redeem)
│   │   │   ├── AmountInput + MAX + TokenBadge
│   │   │   ├── Arrow Separator
│   │   │   ├── OutputPreview + FeeInfo
│   │   │   ├── TxButton
│   │   │   └── AlertStatus
│   │   └── Info Cards (Remaining Mintable, Available for Redemption)
│   │
│   ├── StakePage
│   │   ├── 2 StatCards (Total Staked, Current APY)
│   │   ├── Pool Tabs (smUSD Vault / ETH Pool)
│   │   ├── Stake/Unstake Widget
│   │   │   ├── 2 Balance Cards (mUSD, smUSD)
│   │   │   ├── AmountInput → OutputPreview → ExchangeInfo
│   │   │   ├── TxButton + AlertStatus
│   │   │   └── Active Positions display
│   │   ├── CooldownTimer (10-day cooldown, progress bar)
│   │   ├── AI Yield Aggregation Explainer Card
│   │   └── Unstaking Info Card
│   │
│   │   Canton variant adds:
│   │   ├── 3rd StatCard (Minted Points Earned)
│   │   └── Canton Coin Boost Pool Widget (Coming Soon)
│   │
│   ├── BorrowPage
│   │   ├── Collateral Reference Table
│   │   ├── HealthFactor + Position Summary (conditional)
│   │   ├── Action Card (5-tab: deposit/borrow/repay/withdraw/loop)
│   │   │   ├── CollateralSelector dropdown
│   │   │   ├── AmountInput + MAX
│   │   │   ├── ⚡ Loop tab: LeverageSlider + Position Preview
│   │   │   ├── Active Leverage Position + Close button
│   │   │   ├── TxButton + AlertStatus
│   │   │   └── Liquidation alerts (if at risk)
│   │   ├── HowItWorks × 5
│   │   ├── Loop Explainer Card
│   │   └── LoopingStrategies × 2 (sMUSD Maxi + Canton Maxi)
│   │
│   ├── BridgePage
│   │   ├── PageHeader (badge: Active/PAUSED)
│   │   ├── PausedAlert (conditional)
│   │   ├── StatCard × 4
│   │   ├── SupplyCapUtilization + HealthRatio (2-col)
│   │   ├── BridgeParameters (3-col grid)
│   │   ├── AttestationHistory (table, recent 20 events)
│   │   ├── BridgeOutPanel
│   │   ├── HowItWorks × 6 (pipeline)
│   │   └── BLE Explainer Card
│   │
│   ├── PointsPage
│   │   ├── PageHeader ("Points & Referrals")
│   │   ├── StatCard × 4 (Total Points, Rank, Referrals, Boost)
│   │   ├── Tab Nav (Overview / My Referrals / Leaderboard)
│   │   ├── Overview Tab
│   │   │   ├── Points Breakdown (6-row activity rate table)
│   │   │   └── ReferralWidget (compact card)
│   │   ├── My Referrals Tab → ReferralTracker
│   │   │   ├── StatCard × 4
│   │   │   ├── Multiplier Progress + Tier Table
│   │   │   ├── Referee List
│   │   │   ├── Your Referral Chain
│   │   │   └── Global Stats
│   │   └── Leaderboard Tab → ReferralLeaderboard
│   │       ├── Time Range Filter
│   │       ├── Your Position Banner
│   │       └── Top 50 Table (medal icons, YOU badge)
│   │
│   └── AdminPage
│       ├── Admin Role Verification (useIsAdmin)
│       ├── 8-Section Tab Bar
│       ├── Section Forms (inputs + TxButtons)
│       ├── YieldScanner (Treasury section)
│       └── AIYieldOptimizer (Treasury section)
│
└── Footer
    ├── Status indicator
    ├── Links (Docs · GitHub · Discord)
    └── Copyright
```

---

## File Map (actual codebase)

```
frontend/src/
├── pages/
│   ├── index.tsx              — SPA router (useState page switch, 7 ETH + 6 Canton pages)
│   ├── _app.tsx               — Next.js app wrapper (providers: WalletConnect, MetaMask, Unified, Loop)
│   ├── _document.tsx          — HTML document (CSP with nonce-based scripts)
│   ├── DashboardPage.tsx      — Dashboard: 3 tabs (Mint/Portfolio/Protocol) + ReferralWidget
│   ├── MintPage.tsx           — USDC ↔ mUSD mint/redeem + cross-chain deposits
│   ├── StakePage.tsx          — mUSD ↔ smUSD stake/unstake + ETH Pool (smUSD-E)
│   ├── BorrowPage.tsx         — Collateral deposit, borrow, repay, withdraw + leverage looping
│   ├── BridgePage.tsx         — Canton attestation monitoring + BridgeOutPanel
│   ├── PointsPage.tsx         — Points breakdown + referral tabs (Overview/Referrals/Leaderboard)
│   ├── AdminPage.tsx          — Protocol admin (8 sections + YieldScanner + AIYieldOptimizer)
│   └── api/
│       ├── yields.ts          — API route: yield data
│       ├── onboard.ts         — API route: onboarding
│       └── prices.ts          — API route: crypto prices
│
├── components/
│   ├── Layout.tsx             — Shell: navbar, main content, footer
│   ├── Navbar.tsx             — Top nav: 7 items + chain toggle + wallet button
│   ├── LandingPage.tsx        — Pre-app gate (stub: headline + CTAs + 3 cards)
│   ├── ChainToggle.tsx        — ETH ⟷ Canton pill switch
│   ├── ChainSelector.tsx      — Multi-chain dropdown (Base/Arbitrum/Solana/Ethereum)
│   ├── StatCard.tsx           — Metric card (icon, trend)
│   ├── PageHeader.tsx         — Title + subtitle + badge
│   ├── Section.tsx            — Content section wrapper
│   ├── TxButton.tsx           — Transaction button (4 variants, 2 sizes, loading state)
│   ├── WalletConnector.tsx    — Wallet connection card
│   ├── ReferralWidget.tsx     — Compact referral card (codes, stats, tiers)
│   ├── ReferralTracker.tsx    — Full referral tracking panel
│   ├── ReferralLeaderboard.tsx— Top-50 referral ranking table
│   ├── BridgeOutPanel.tsx     — Bridge UI for Ethereum → Canton transfers
│   ├── LeverageSlider.tsx     — 2x-5x leverage slider with risk viz
│   ├── YieldScanner.tsx       — Live market yield tracker
│   ├── AIYieldOptimizer.tsx   — AI allocation recommendations
│   ├── PendingDepositsList.tsx— Pending deposit tracker
│   ├── OnboardingFlow.tsx     — First-time user guide
│   ├── ErrorBoundary.tsx      — React error boundary
│   └── canton/
│       ├── CantonDashboard.tsx
│       ├── CantonMint.tsx
│       ├── CantonStake.tsx
│       ├── CantonBorrow.tsx
│       ├── CantonBridge.tsx
│       ├── CantonAdmin.tsx
│       └── index.ts
│
├── hooks/
│   ├── useWalletConnect.tsx   — Primary wallet hook (address, signer, provider, ENS)
│   ├── useWCContracts.ts      — All protocol contract instances (12 contracts)
│   ├── useEthContracts.ts     — Ethereum contract set
│   ├── useContract.ts         — Individual contract hook factory
│   ├── useTx.ts               — Transaction execution (simulate → send → track)
│   ├── useChain.ts            — Chain state (ethereum / canton toggle)
│   ├── useReferral.ts         — Referral system (generate/apply codes, dashboard, tiers)
│   ├── useMetaMask.tsx        — MetaMask-specific wallet
│   ├── useUnifiedWallet.tsx   — Multi-wallet support
│   ├── useLoopWallet.tsx      — Canton Loop wallet (party ID)
│   ├── useYieldOptimizer.ts   — AI yield optimization logic
│   ├── useYieldScanner.ts     — Live yield data fetching
│   ├── useCryptoPrices.tsx    — Token price fetching
│   ├── usePendingDeposits.tsx — Pending deposit status tracking
│   ├── useMultiChainDeposit.tsx — Cross-chain deposit + bridge
│   ├── useCantonBoostPool.ts  — Canton boost pool metrics
│   ├── useIsAdmin.ts          — Admin role checker
│   ├── useOnboarding.ts       — Onboarding state tracker
│   ├── wallet.ts              — Wallet utilities
│   └── index.ts               — Barrel export
│
├── lib/
│   ├── config.ts              — Contract addresses, decimals, chain IDs, RPC endpoints
│   ├── format.ts              — formatUSD, formatToken, formatBps, formatHealthFactor, shortenAddress, formatTimestamp
│   ├── chains.ts              — Chain metadata, USDC decimals per chain, bridge time estimates
│   ├── walletconnect.ts       — WalletConnect provider setup
│   ├── metamask.ts            — MetaMask provider detection
│   └── yield-optimizer.ts     — Strategy scoring + allocation calculations
│
├── types/
│   └── loop-sdk.d.ts          — Loop SDK type definitions
│
├── abis/                      — Contract ABI TypeScript exports
│   ├── MUSD.ts, SMUSD.ts, DirectMint.ts, Treasury.ts
│   ├── CollateralVault.ts, BorrowModule.ts, LiquidationEngine.ts
│   └── BLEBridgeV9.ts, PriceOracle.ts, ERC20.ts
│
└── styles/
    └── globals.css            — Full Tailwind design system (~350 lines)
```

---

## What's Still TODO (SPEC sections not yet coded)

| Feature | Page | Priority | Description |
|---------|------|----------|-------------|
| Landing Page THREE.js scene | Landing | P1 | Particle system, mouse-follow camera |
| Landing Page stat cards | Landing | P1 | Live protocol stats (supply, APY, users, Canton value) |
| Season Progress Bar | Points | P2 | Season timeline with progress, multiplier, days remaining |
| Points Calculator tab | Points | P2 | Implied APY, scenarios table, multiplier schedule |
| 3 Seasons Multiplier Table | Points | P2 | Season 1/2/3 multiplier breakdown per action |
| What Earns Points grid | Points | P2 | Canton vs Ethereum 2-column comparison |
| Points APY by TVL table | Points | P2 | APY projections at different TVL levels |
| Maximize Your Points tips | Points | P3 | 4 strategy tips for maximizing points |
| Airdrop Info Card | Points | P3 | Points → $MINT token conversion details |

