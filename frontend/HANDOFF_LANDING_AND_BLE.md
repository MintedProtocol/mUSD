# Minted Protocol — Marquee Landing & BLE Page Handoff

> Two pages that live outside the main mUSD dApp:
> 1. **Marquee Landing** — the first thing users see at minted.app
> 2. **BLE Product Page** — marketing/info page for the Beneficiary Locked Environment

---

## Page 1: Marquee Landing (`minted.app`)

### Purpose
Top-level entry point for the Minted Protocol. Full-viewport THREE.js scene. Two product buttons route users to either the mUSD dApp or the BLE product page.

This is NOT the mUSD app landing page (which is `LandingPage.tsx` inside the SPA). This sits above it.

### Layout

Full viewport. No scroll. No footer. No navbar.

```
┌──────────────────────────────────────────────────────────────────┐
│  THREE.js Animated Scene (full viewport, behind all content)     │
│                                                                  │
│  • Particle system (spherical distribution)                      │
│  • Neural-network connection lines between nearby particles      │
│  • Mouse-follow camera (smooth lerp)                             │
│  • Overlay for text legibility                                   │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                        [Logo: Minted Protocol]                   │
│                                                                  │
│                 "The Institutional Ownership                     │
│                  Reserve Currency"                                │
│                                                                  │
│          Powered by Canton Network · Ethereum                    │
│                                                                  │
│     ┌─────────────────────┐   ┌─────────────────────┐           │
│     │       mUSD          │   │        BLE           │           │
│     │  Stablecoin dApp    │   │  Bridge Protocol     │           │
│     │  [Enter mUSD App]   │   │  [Learn About BLE]   │           │
│     └─────────────────────┘   └─────────────────────┘           │
│                                                                  │
│  4 Live Protocol Stats:                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────────────┐│
│  │ mUSD     │ │ Staking  │ │ Total    │ │ Canton Attested     ││
│  │ Supply   │ │ APY      │ │ Users    │ │ Value               ││
│  │ $24.8M   │ │ 12.4%    │ │ 3,847    │ │ $18.2M              ││
│  └──────────┘ └──────────┘ └──────────┘ └─────────────────────┘│
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Content

**Headline:** "The Institutional Ownership Reserve Currency"
**Sub-headline:** "Powered by Canton Network · Ethereum"

**Product Cards (2):**

| Card | Title | Description | Button | Destination |
|------|-------|-------------|--------|-------------|
| mUSD | Stablecoin dApp | Mint, stake, borrow, and earn yield across chains | Enter mUSD App | Loads the mUSD SPA (DashboardPage) |
| BLE | Bridge Protocol | Institutional cross-chain attestation bridge | Learn About BLE | Navigates to BLE product page |

**4 Live Stat Cards (fetched from on-chain data):**

| Stat | Source | Description |
|------|--------|-------------|
| mUSD Supply | `MUSD.totalSupply()` | Total circulating mUSD |
| Staking APY | Calculated from smUSD yield | Current smUSD staking yield % |
| Total Users | Off-chain or event-based count | Protocol participants |
| Canton Attested Value | `BLEBridgeV9` attestation data | Total RWA value attested on Canton |

### THREE.js Scene Requirements

- Full-viewport 3D canvas behind all content
- Particle system (additive blending, spherical distribution)
- Connection lines between nearby particles (neural-network style)
- Mouse-follow camera with smooth interpolation
- Overlay layer to ensure text legibility over the scene
- Must not block interaction with buttons/text
- Performance: target 60fps on modern hardware, degrade gracefully on mobile

### Behavior

- No scroll content below the fold
- No hamburger menu, no navbar, no footer
- "Enter mUSD App" → loads the mUSD SPA (sets `appLaunched=true`, shows Dashboard)
- "Learn About BLE" → navigates to BLE product page (can be a route or scroll-to section)
- Stat cards poll live data on mount

### Current State

`LandingPage.tsx` exists as a stub with headline + 2 buttons + 3 feature cards. Needs to be rebuilt as this marquee page with THREE.js scene, 2 product cards, and live stat cards.

---

## Page 2: BLE Product Page

### Purpose
Marketing/information page for the Beneficiary Locked Environment — Minted's proprietary cross-chain bridge protocol. Explains what BLE is, how it works, key stats, and why institutions should care.

This is a standalone page, not inside the mUSD SPA.

### Layout

Scrollable single-page layout. Sections stack vertically.

```
┌──────────────────────────────────────────────────────────────────┐
│  Minimal Nav Bar                                                  │
│  [← Back to Minted]                          [Enter mUSD App]   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  HERO SECTION                                                    │
│  "Beneficiary Locked Environment"                                │
│  "Institutional-grade cross-chain attestation bridge"            │
│  "Connecting Canton Network RWA to Ethereum DeFi"                │
│                                                                  │
│  3 Key Stats (from on-chain):                                    │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │ Attested     │ │ Bridge       │ │ Collateral   │            │
│  │ Assets       │ │ Health       │ │ Ratio        │            │
│  │ $18.2M       │ │ 1.85x       │ │ 150%         │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  WHAT IS BLE?                                                    │
│  Paragraph explaining BLE in plain language                      │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  HOW IT WORKS — 6-Step Pipeline                                  │
│  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐       │
│  │  1  │→ │  2  │→ │  3  │→ │  4  │→ │  5  │→ │  6  │       │
│  │Obsrv│  │Vrfy │  │Sign │  │Aggr │  │Updt │  │Mint │       │
│  └─────┘  └─────┘  └─────┘  └─────┘  └─────┘  └─────┘       │
│                                                                  │
│  Step descriptions below each                                    │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  KEY FEATURES (grid)                                             │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │ Multi-Sig        │  │ Overcollateral-  │                    │
│  │ Validation       │  │ ized             │                    │
│  │ 3-of-5 ECDSA     │  │ 150% backing     │                    │
│  └──────────────────┘  └──────────────────┘                    │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │ Rate Limited     │  │ Real-Time        │                    │
│  │                  │  │ Monitoring       │                    │
│  │ 24hr rolling cap │  │ Live dashboard   │                    │
│  └──────────────────┘  └──────────────────┘                    │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │ Emergency        │  │ Canton           │                    │
│  │ Controls         │  │ Settlement       │                    │
│  │ Pause + cap cut  │  │ Privacy + DeFi   │                    │
│  └──────────────────┘  └──────────────────┘                    │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  LIVE BRIDGE STATUS (from on-chain)                              │
│  Supply Cap Utilization: [██████████░░░░░] XX.X%                │
│  Bridge Health Ratio: X.XX                                       │
│  Required Signatures: 3 of 5                                     │
│  Current Nonce: XX                                               │
│  Last Attestation: Xm ago                                        │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  CTA                                                             │
│  [Enter mUSD App]    [View Bridge Dashboard]    [Read Docs]     │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  Footer                                                          │
└──────────────────────────────────────────────────────────────────┘
```

### Section Details

#### Hero
- **Headline:** "Beneficiary Locked Environment"
- **Sub-headline:** "Institutional-grade cross-chain attestation bridge"
- **Description:** "Connecting Canton Network real-world assets to Ethereum DeFi"
- **3 stat cards:** Attested Assets, Bridge Health, Collateral Ratio (live from BLEBridgeV9 contract)

#### What Is BLE?

> The Beneficiary Locked Environment (BLE) is Minted's proprietary cross-chain attestation system. It connects Canton Network — where institutions tokenize and settle real-world assets — to Ethereum, where those assets back the mUSD stablecoin.
>
> Unlike traditional bridges that lock-and-mint with optimistic windows, BLE uses a multi-signature validator network where institutional validators independently verify asset positions on Canton before signing cryptographic attestations. These attestations govern mUSD's supply cap on Ethereum — assets stay on Canton, value flows to Ethereum, and both chains maintain settlement finality.

#### How It Works — 6-Step Pipeline

| Step | Name | Description |
|------|------|-------------|
| 1 | **Observe** | Validators observe real-world asset positions locked on Canton Network |
| 2 | **Verify** | Each validator independently verifies asset values and eligibility |
| 3 | **Sign** | Validators sign ECDSA attestations (3-of-5 multi-sig threshold) |
| 4 | **Aggregate** | Aggregator collects signatures and submits to BLEBridgeV9 on Ethereum |
| 5 | **Update** | Bridge contract updates mUSD supply cap (enforcing collateral ratio) |
| 6 | **Mint** | Users can mint mUSD up to the new supply cap using USDC collateral |

#### Key Features (6 cards, 2×3 grid)

| Feature | Headline | Description |
|---------|----------|-------------|
| Multi-Sig Validation | 3-of-5 ECDSA | Validators independently verify before signing. No single point of failure. |
| Overcollateralized | 150% backing ratio | mUSD is always backed by 1.5x the value in Canton-attested RWA. Enforced on-chain. |
| Rate Limited | 24hr rolling window | Supply cap changes are rate-limited to prevent sudden manipulation. |
| Real-Time Monitoring | Live dashboard | Supply cap utilization, health ratio, attestation history — all visible on-chain. |
| Emergency Controls | Pause + cap reduction | Guardian role can pause bridge and reduce cap instantly in emergencies. |
| Canton Settlement | Privacy + DeFi composability | Assets stay on Canton (private institutional chain). Value circulates on Ethereum (public DeFi). |

#### Live Bridge Status
Live data fetched from BLEBridgeV9 contract:

| Metric | Source |
|--------|--------|
| Supply Cap Utilization | `MUSD.totalSupply()` / `BLEBridgeV9.supplyCap()` |
| Bridge Health Ratio | `cantonAssets` / `supplyCap` |
| Required Signatures | `BLEBridgeV9.minSignatures()` |
| Current Nonce | `BLEBridgeV9.currentNonce()` |
| Last Attestation | Timestamp from most recent `AttestationSubmitted` event |

#### CTA Section
3 buttons:
- **Enter mUSD App** → loads mUSD SPA
- **View Bridge Dashboard** → navigates to Bridge page inside mUSD app
- **Read Docs** → external docs link

---

## Implementation Notes

### Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `pages/index.tsx` | Modify | Add marquee landing as the root view (before `appLaunched`) |
| `components/MarqueeLanding.tsx` | Create | THREE.js scene + 2 product cards + 4 stat cards |
| `components/BLEProductPage.tsx` | Create | Scrollable marketing page with all sections above |
| `components/ThreeScene.tsx` | Create | Reusable THREE.js particle scene (shared by marquee and potentially mUSD landing) |
| `LandingPage.tsx` | Modify or replace | Current stub becomes either the marquee or gets removed in favor of `MarqueeLanding.tsx` |

### Data Dependencies

Both pages need read-only access to:
- `MUSD.totalSupply()` and `MUSD.supplyCap()`
- `BLEBridgeV9` attestation data (supply cap, canton assets, health ratio, nonce, min signatures)
- `SMUSD.convertToAssets()` for APY calculation
- Event logs for `AttestationSubmitted` (last attestation timestamp)

No wallet connection required to view either page. Data can be fetched via public RPC.

### Routing

| URL | Component | Wallet Required |
|-----|-----------|----------------|
| `/` (root, before app launch) | `MarqueeLanding` | No |
| `/ble` or scroll section | `BLEProductPage` | No |
| After "Enter mUSD App" click | mUSD SPA (`Layout` + page router) | No (prompted on action) |

---

## What's Still TODO

| Item | Priority | Notes |
|------|----------|-------|
| THREE.js particle scene | P1 | Core visual for marquee landing |
| MarqueeLanding component | P1 | Layout + 2 product cards + 4 stats |
| BLEProductPage component | P1 | All 6 sections described above |
| ThreeScene reusable component | P2 | Extract for reuse on mUSD landing if needed |
| Live data hooks (no wallet) | P2 | Public RPC read-only hooks for stats |
| Mobile responsive layout | P2 | Both pages must work on mobile |
