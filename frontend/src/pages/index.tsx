import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { useUnifiedWallet } from "@/hooks/useUnifiedWallet";
import { useWCContracts } from "@/hooks/useWCContracts";
import { useChainState } from "@/hooks/useChain";
import { useLoopWallet } from "@/hooks/useLoopWallet";

// Ethereum pages
import { DashboardPage } from "./DashboardPage";
import { MintPage } from "./MintPage";
import { StakePage } from "./StakePage";
import { BorrowPage } from "./BorrowPage";
import { BridgePage } from "./BridgePage";
import { AdminPage } from "./AdminPage";
import { PointsPage } from "./PointsPage";
import { FaucetPage } from "./FaucetPage";

// Canton pages
import { CantonDashboard } from "@/components/canton/CantonDashboard";
import { CantonMint } from "@/components/canton/CantonMint";
import { CantonStake } from "@/components/canton/CantonStake";
import { CantonBorrow } from "@/components/canton/CantonBorrow";
import { CantonBridge } from "@/components/canton/CantonBridge";
import { CantonAdmin } from "@/components/canton/CantonAdmin";
import { DevnetFaucet } from "@/components/canton/DevnetFaucet";

export default function Home() {
  const router = useRouter();
  const wallet = useUnifiedWallet();
  const contracts = useWCContracts();
  const chainState = useChainState();
  const loopWallet = useLoopWallet();
  const [page, setPage] = useState("dashboard");

  // Keep URL in sync with active page for deep-linkable navigation
  useEffect(() => {
    const qp = router.query.page;
    if (typeof qp === "string" && qp !== page) {
      setPage(qp);
    }
  }, [router.query.page]);

  const handleNavigate = (next: string) => {
    setPage(next);
    router.replace({ pathname: "/", query: next === "dashboard" ? {} : { page: next } }, undefined, {
      shallow: true,
    });
  };

  function renderPage() {
    if (chainState.chain === "canton") {
      switch (page) {
        case "dashboard":
          return <CantonDashboard />;
        case "mint":
          return <CantonMint />;
        case "stake":
          return <CantonStake />;
        case "borrow":
          return <CantonBorrow />;
        case "bridge":
          return <CantonBridge />;
        case "points":
          return <PointsPage />;
        case "faucet":
          return <DevnetFaucet />;
        case "admin":
          return <CantonAdmin />;
        default:
          return <CantonDashboard />;
      }
    }

    // Ethereum - pages will use hooks internally
    switch (page) {
      case "dashboard":
        return <DashboardPage onNavigate={setPage} />;
      case "mint":
        return <MintPage />;
      case "stake":
        return <StakePage />;
      case "borrow":
        return <BorrowPage />;
      case "bridge":
        return <BridgePage />;
      case "faucet":
        return <FaucetPage />;
      case "points":
        return <PointsPage />;
      case "admin":
        return <AdminPage />;
      default:
        return <DashboardPage />;
    }
  }

  return (
    <Layout
      address={wallet.address}
      onConnect={() => wallet.connectMetaMask()}
      onDisconnect={() => wallet.disconnect()}
      isEthConnecting={wallet.isConnecting}
      activePage={page}
      onNavigate={handleNavigate}
      chain={chainState.chain}
      onToggleChain={chainState.toggle}
      cantonParty={loopWallet.partyId}
      onCantonConnect={() => loopWallet.connect()}
      onCantonDisconnect={() => loopWallet.disconnect()}
      isCantonConnecting={loopWallet.isConnecting}
    >
      {wallet.error && chainState.chain === "ethereum" && (
        <div className="mb-6 rounded-lg border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">
          {wallet.error}
        </div>
      )}
      {loopWallet.error && chainState.chain === "canton" && (
        <div className="mb-6 rounded-lg border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">
          Canton: {loopWallet.error}
        </div>
      )}
      {renderPage()}
    </Layout>
  );
}
