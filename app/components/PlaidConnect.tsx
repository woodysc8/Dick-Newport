"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";

type RefreshResponse = {
  success: boolean;
  error?: string;
  items?: Array<{
    institution: string;
    status: "success" | "error";
    transactions_added: number;
    transactions_modified: number;
    transactions_removed: number;
    accounts_updated: number;
    accounts_created: number;
    holdings_updated: number;
    errors: string[];
  }>;
};

type PlaidConnectProps = {
  investmentPlaidItemId?: string | null;
};

export default function PlaidConnect({ investmentPlaidItemId }: PlaidConnectProps) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [investmentUpdateLinkToken, setInvestmentUpdateLinkToken] = useState<string | null>(null);
  const [biltRepairLinkToken, setBiltRepairLinkToken] = useState<string | null>(null);
  const [linkStatus, setLinkStatus] = useState("");
  const [refreshStatus, setRefreshStatus] = useState("");
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [investmentConsentStatus, setInvestmentConsentStatus] = useState("");
  const [investmentConsentError, setInvestmentConsentError] = useState<string | null>(null);
  const [biltRepairStatus, setBiltRepairStatus] = useState("");
  const [biltRepairError, setBiltRepairError] = useState<string | null>(null);
  const [isPreparingBiltRepair, setIsPreparingBiltRepair] = useState(false);
  const [isPreparingInvestmentConsent, setIsPreparingInvestmentConsent] = useState(false);
  const [shouldOpenInvestmentUpdate, setShouldOpenInvestmentUpdate] = useState(false);
  const [shouldOpenBiltRepair, setShouldOpenBiltRepair] = useState(false);

  const refreshFinancialData = useCallback(async () => {
    if (isRefreshing) return false;
    setIsRefreshing(true);
    setRefreshStatus("Refreshing financial data...");
    setRefreshError(null);
    try {
      const response = await fetch("/api/plaid/refresh", { method: "POST" });
      const data = (await response.json()) as RefreshResponse;
      const failedItems = data.items?.filter((item) => item.status === "error") ?? [];
      if (!response.ok || !data.success || failedItems.length > 0) {
        const details = failedItems.map((item) => `${item.institution}: ${item.errors.join(", ")}`).join("; ");
        throw new Error((data.error ?? details) || "Financial refresh failed");
      }
      const changes = (data.items ?? []).reduce(
        (total, item) => total + item.transactions_added + item.transactions_modified + item.transactions_removed,
        0
      );
      setRefreshStatus(`Financial data refreshed (${changes} transaction changes).`);
      router.refresh();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Financial refresh failed";
      console.error("Financial refresh error:", message);
      setRefreshStatus("");
      setRefreshError(message);
      return false;
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, router]);

  const createLinkToken = async () => {
    setLinkStatus("Connecting to Plaid...");
    try {
      const response = await fetch("/api/plaid/create-link-token", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.details || "Failed to create link token");
      setLinkToken(data.link_token);
      setLinkStatus("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Plaid Link setup error:", message);
      setLinkStatus(message);
    }
  };

  const createInvestmentUpdateLinkToken = async () => {
    if (!investmentPlaidItemId || isPreparingInvestmentConsent || investmentUpdateLinkToken) return;
    setIsPreparingInvestmentConsent(true);
    setInvestmentConsentStatus("Preparing Investment consent...");
    setInvestmentConsentError(null);
    try {
      const response = await fetch("/api/plaid/create-investment-update-link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plaid_item_id: investmentPlaidItemId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to prepare Investment consent");
      setInvestmentUpdateLinkToken(data.link_token);
      setShouldOpenInvestmentUpdate(true);
      setInvestmentConsentStatus("Opening Plaid to enable Investment Holdings...");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Investment consent setup error:", message);
      setInvestmentConsentStatus("");
      setInvestmentConsentError(message);
    } finally {
      setIsPreparingInvestmentConsent(false);
    }
  };

  const createBiltRepairLinkToken = async () => {
    if (isPreparingBiltRepair || biltRepairLinkToken || isRefreshing) return;
    setIsPreparingBiltRepair(true);
    setBiltRepairStatus("Preparing Bilt repair...");
    setBiltRepairError(null);
    try {
      const response = await fetch("/api/plaid/create-bilt-repair-link-token", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to prepare Bilt repair");
      setBiltRepairLinkToken(data.link_token);
      setShouldOpenBiltRepair(true);
      setBiltRepairStatus("Opening Plaid to repair the existing Bilt connection...");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBiltRepairStatus("");
      setBiltRepairError(message);
    } finally {
      setIsPreparingBiltRepair(false);
    }
  };

  const onSuccess = useCallback(async (publicToken: string | null) => {
    if (!publicToken) {
      setLinkStatus("Plaid did not return a public token.");
      return;
    }
    setLinkStatus("Finalizing your connection...");
    try {
      const response = await fetch("/api/plaid/exchange-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_token: publicToken }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.details || "Failed exchange");
      setLinkStatus("Plaid connection successful.");
      await refreshFinancialData();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Plaid exchange error:", message);
      setLinkStatus(message);
    }
  }, [refreshFinancialData]);

  const onInvestmentUpdateSuccess = useCallback(async () => {
    // Update-mode Link preserves the existing Item and access token. Never exchange its public token.
    setInvestmentConsentStatus("Investment consent granted. Refreshing holdings...");
    setInvestmentConsentError(null);
    const refreshed = await refreshFinancialData();
    if (refreshed) {
      setInvestmentConsentStatus("Investment Holdings enabled.");
      setInvestmentUpdateLinkToken(null);
    } else {
      setInvestmentConsentError("Consent was completed, but the financial refresh did not succeed. Try Refresh Financial Data.");
    }
  }, [refreshFinancialData]);

  const onBiltRepairSuccess = useCallback(async () => {
    setBiltRepairStatus("Bilt connection repaired. Refreshing financial data...");
    setBiltRepairError(null);
    const refreshed = await refreshFinancialData();
    if (refreshed) {
      setBiltRepairStatus("Bilt connection repaired and financial data refreshed.");
      setBiltRepairLinkToken(null);
    } else {
      setBiltRepairError("Bilt repair completed, but the financial refresh did not succeed.");
    }
  }, [refreshFinancialData]);

  const onBiltRepairExit = useCallback((error: { error_message?: string } | null) => {
    setShouldOpenBiltRepair(false);
    setBiltRepairLinkToken(null);
    if (error?.error_message) {
      setBiltRepairStatus("");
      setBiltRepairError(error.error_message);
    } else {
      setBiltRepairStatus("Bilt repair was canceled.");
    }
  }, []);

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess });
  const {
    open: openInvestmentUpdate,
    ready: investmentUpdateReady,
  } = usePlaidLink({ token: investmentUpdateLinkToken, onSuccess: onInvestmentUpdateSuccess });
  const {
    open: openBiltRepair,
    ready: biltRepairReady,
  } = usePlaidLink({ token: biltRepairLinkToken, onSuccess: onBiltRepairSuccess, onExit: onBiltRepairExit });

  useEffect(() => {
    if (shouldOpenInvestmentUpdate && investmentUpdateLinkToken && investmentUpdateReady) {
      setShouldOpenInvestmentUpdate(false);
      openInvestmentUpdate();
    }
  }, [investmentUpdateLinkToken, investmentUpdateReady, openInvestmentUpdate, shouldOpenInvestmentUpdate]);

  useEffect(() => {
    if (shouldOpenBiltRepair && biltRepairLinkToken && biltRepairReady) {
      setShouldOpenBiltRepair(false);
      openBiltRepair();
    }
  }, [biltRepairLinkToken, biltRepairReady, openBiltRepair, shouldOpenBiltRepair]);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <button onClick={refreshFinancialData} disabled={isRefreshing} className="rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-black hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
          {isRefreshing ? "Refreshing..." : "Refresh Financial Data"}
        </button>
        {investmentPlaidItemId && !investmentUpdateLinkToken && (
          <button onClick={createInvestmentUpdateLinkToken} disabled={isPreparingInvestmentConsent || isRefreshing} className="rounded-lg border border-emerald-600 px-4 py-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50">
            {isPreparingInvestmentConsent ? "Preparing..." : "Enable Investment Holdings"}
          </button>
        )}
        <button onClick={createBiltRepairLinkToken} disabled={isPreparingBiltRepair || isRefreshing || Boolean(biltRepairLinkToken)} className="rounded-lg border border-emerald-600 px-4 py-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50">
          {isPreparingBiltRepair ? "Preparing..." : "Repair Bilt Connection"}
        </button>
        {!linkToken ? (
          <button onClick={createLinkToken} className="rounded-lg bg-black px-5 py-3 text-white">Connect a Bank Account</button>
        ) : (
          <button onClick={() => open()} disabled={!ready} className="rounded-lg bg-black px-5 py-3 text-white disabled:opacity-50">Open Plaid</button>
        )}
      </div>
      {linkStatus && <p className="text-right text-sm text-gray-600">{linkStatus}</p>}
      {refreshStatus && <p className="text-right text-sm text-emerald-700">{refreshStatus}</p>}
      {refreshError && <p className="max-w-md text-right text-sm text-red-600">Refresh error: {refreshError}</p>}
      {investmentConsentStatus && <p className="text-right text-sm text-emerald-700">{investmentConsentStatus}</p>}
      {investmentConsentError && <p className="max-w-md text-right text-sm text-red-600">Investment consent error: {investmentConsentError}</p>}
      {biltRepairStatus && <p className="text-right text-sm text-emerald-700">{biltRepairStatus}</p>}
      {biltRepairError && <p className="max-w-md text-right text-sm text-red-600">Bilt repair error: {biltRepairError}</p>}
    </div>
  );
}
