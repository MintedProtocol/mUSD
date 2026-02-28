import { useState, useCallback, useRef } from "react";
import { CANTON_CONFIG } from "@/lib/config";

// ============================================================
//  Canton v2 HTTP JSON API types (SDK 3.4.10 / Canton 3.x)
//
//  Replaces the deprecated v1 JSON API endpoints:
//    /v1/query    → POST /v2/state/active-contracts
//    /v1/exercise → POST /v2/commands/submit-and-wait
//    /v1/create   → POST /v2/commands/submit-and-wait
// ============================================================

/** Template identifier for v2 API */
interface TemplateId {
  moduleName: string;
  entityName: string;
  packageId?: string;
}

/** v2 active-contracts response entry */
interface V2ContractEntry {
  contractEntry: {
    JsActiveContract?: {
      createdEvent: {
        contractId: string;
        templateId: string;  // "pkgId:Module:Entity"
        createArgument: Record<string, unknown>;
        createdAt: string;
        offset: number;
        signatories: string[];
        observers: string[];
      };
    };
  };
}

interface CantonContract {
  contractId: string;
  templateId: string;
  payload: Record<string, unknown>;
}

interface CantonState {
  connected: boolean;
  party: string | null;
  userId: string | null;
  error: string | null;
}

/**
 * Parse a "Module.Name:EntityName" or "PkgId:Module.Name:EntityName" string
 * into a TemplateId for the v2 API.
 */
function parseTemplateId(qualified: string): TemplateId {
  const parts = qualified.split(":");
  if (parts.length === 2) {
    return { moduleName: parts[0], entityName: parts[1] };
  } else if (parts.length === 3) {
    return { packageId: parts[0], moduleName: parts[1], entityName: parts[2] };
  }
  throw new Error(`Invalid template ID: "${qualified}" (expected "Module:Entity" or "Pkg:Module:Entity")`);
}

/**
 * Hook for interacting with Canton Network Daml ledger via v2 HTTP JSON API.
 * Compatible with Canton 3.x / Daml SDK 3.4.10.
 *
 * Uses configurable protocol (http/https)
 * Token stored securely in ref, not exposed in config
 */
export function useCanton() {
  const [state, setState] = useState<CantonState>({
    connected: false,
    party: null,
    userId: null,
    error: null,
  });
  // Token is now set via setToken, not from public config
  const tokenRef = useRef<string>("");
  const partyRef = useRef<string>("");
  const userIdRef = useRef<string>("administrator");
  // Use configurable protocol (https in production)
  const baseUrl = `${CANTON_CONFIG.protocol}://${CANTON_CONFIG.ledgerHost}:${CANTON_CONFIG.ledgerPort}`;

  const setToken = useCallback((token: string, party: string, userId?: string) => {
    tokenRef.current = token;
    partyRef.current = party;
    if (userId) userIdRef.current = userId;
    setState({ connected: true, party, userId: userId || "administrator", error: null });
  }, []);

  const disconnect = useCallback(() => {
    tokenRef.current = "";
    partyRef.current = "";
    setState({ connected: false, party: null, userId: null, error: null });
  }, []);

  const headers = useCallback(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${tokenRef.current}`,
  }), []);

  /**
   * Query active contracts by template.
   * Uses v2 API: POST /v2/state/active-contracts
   */
  const query = useCallback(
    async (templateId: string, filter?: (payload: Record<string, unknown>) => boolean): Promise<CantonContract[]> => {
      try {
        // First get the current ledger end offset
        const endResp = await fetch(`${baseUrl}/v2/state/ledger-end`, {
          method: "GET",
          headers: headers(),
        });
        if (!endResp.ok) throw new Error(`Ledger end failed: ${endResp.status}`);
        const { offset } = await endResp.json();

        // Parse template ID for v2 filter format
        const tpl = parseTemplateId(templateId);
        const tid: Record<string, string> = {
          moduleName: tpl.moduleName,
          entityName: tpl.entityName,
        };
        if (tpl.packageId) tid.packageId = tpl.packageId;

        const body = {
          filter: {
            filtersByParty: {
              [partyRef.current]: {
                identifierFilter: {
                  templateFilter: {
                    value: { templateId: tid },
                  },
                },
              },
            },
          },
          activeAtOffset: offset,
        };

        const resp = await fetch(`${baseUrl}/v2/state/active-contracts`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`Query failed: ${resp.status}`);
        const entries: V2ContractEntry[] = await resp.json();

        const contracts: CantonContract[] = [];
        for (const entry of entries) {
          const ac = entry.contractEntry?.JsActiveContract;
          if (!ac) continue;
          const evt = ac.createdEvent;

          // Client-side template filtering
          const parts = evt.templateId.split(":");
          const mod = parts.length >= 3 ? parts[parts.length - 2] : "";
          const ent = parts.length >= 3 ? parts[parts.length - 1] : "";
          if (mod !== tpl.moduleName || ent !== tpl.entityName) continue;

          const contract: CantonContract = {
            contractId: evt.contractId,
            templateId: evt.templateId,
            payload: evt.createArgument,
          };

          if (filter && !filter(contract.payload)) continue;
          contracts.push(contract);
        }

        return contracts;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setState((s) => ({ ...s, error: message }));
        return [];
      }
    },
    [baseUrl, headers]
  );

  /**
   * Exercise a choice on a contract.
   * Uses v2 API: POST /v2/commands/submit-and-wait
   */
  const exercise = useCallback(
    async (
      templateId: string,
      contractId: string,
      choice: string,
      argument: Record<string, unknown>
    ): Promise<unknown> => {
      try {
        const tpl = parseTemplateId(templateId);
        const tid: Record<string, string> = {
          moduleName: tpl.moduleName,
          entityName: tpl.entityName,
        };
        if (tpl.packageId) tid.packageId = tpl.packageId;

        const commandId = `fe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const body = {
          userId: userIdRef.current,
          actAs: [partyRef.current],
          readAs: [],
          commandId,
          commands: [
            {
              exerciseCommand: {
                templateId: tid,
                contractId,
                choice,
                choiceArgument: argument,
              },
            },
          ],
        };

        const resp = await fetch(`${baseUrl}/v2/commands/submit-and-wait`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`Exercise failed: ${resp.status}`);
        return await resp.json();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setState((s) => ({ ...s, error: message }));
        throw err;
      }
    },
    [baseUrl, headers]
  );

  /**
   * Create a new contract.
   * Uses v2 API: POST /v2/commands/submit-and-wait
   */
  const create = useCallback(
    async (templateId: string, payload: Record<string, unknown>): Promise<string> => {
      try {
        const tpl = parseTemplateId(templateId);
        const tid: Record<string, string> = {
          moduleName: tpl.moduleName,
          entityName: tpl.entityName,
        };
        if (tpl.packageId) tid.packageId = tpl.packageId;

        const commandId = `fe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const body = {
          userId: userIdRef.current,
          actAs: [partyRef.current],
          readAs: [],
          commandId,
          commands: [
            {
              createCommand: {
                templateId: tid,
                createArgument: payload,
              },
            },
          ],
        };

        const resp = await fetch(`${baseUrl}/v2/commands/submit-and-wait`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`Create failed: ${resp.status}`);
        const result = await resp.json();
        // Extract contractId from v2 response
        const events = result?.completionResponse?.updateId
          ? [result]
          : [];
        // The v2 submit-and-wait returns transaction tree — extract created contract ID
        return events.length > 0 ? result.completionResponse?.updateId || "" : "";
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setState((s) => ({ ...s, error: message }));
        throw err;
      }
    },
    [baseUrl, headers]
  );

  return { ...state, setToken, disconnect, query, exercise, create };
}
