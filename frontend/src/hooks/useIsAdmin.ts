/**
 * useIsAdmin Hook (H-08)
 *
 * Checks whether the connected wallet holds the DEFAULT_ADMIN_ROLE on the MUSD
 * contract. Used to gate access to the AdminPage so that only authorized
 * addresses can view and interact with admin functions.
 *
 * Returns { isAdmin, isLoading } — use isLoading to show a spinner while
 * the on-chain check is in flight.
 */

import { useState, useEffect } from "react";
import { useUnifiedWallet } from "./useUnifiedWallet";
import { useWCContracts } from "./useWCContracts";

// bytes32(0) — DEFAULT_ADMIN_ROLE in OpenZeppelin AccessControl
const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

// TIMELOCK_ROLE = keccak256("TIMELOCK_ROLE")
const TIMELOCK_ROLE = "0xf66846415d2bf9eabda9e84793ff9c0ea96d87f50fc41e66aa16469c6a442f05";

export function useIsAdmin(): { isAdmin: boolean; isLoading: boolean } {
  const { address, isConnected } = useUnifiedWallet();
  const contracts = useWCContracts();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function checkAdmin() {
      if (!isConnected || !address || !contracts.musd) {
        setIsAdmin(false);
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);

        // Check both DEFAULT_ADMIN_ROLE and TIMELOCK_ROLE on the MUSD contract
        const [hasAdmin, hasTimelock] = await Promise.all([
          contracts.musd.hasRole(DEFAULT_ADMIN_ROLE, address) as Promise<boolean>,
          contracts.musd.hasRole(TIMELOCK_ROLE, address) as Promise<boolean>,
        ]);

        if (!cancelled) {
          setIsAdmin(hasAdmin || hasTimelock);
        }
      } catch (err) {
        console.error("[useIsAdmin] Failed to check admin role:", err);
        if (!cancelled) {
          setIsAdmin(false);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    checkAdmin();

    return () => {
      cancelled = true;
    };
  }, [address, isConnected, contracts.musd]);

  return { isAdmin, isLoading };
}
