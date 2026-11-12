import { personalPlaidRoute } from "../../../../lib/plaidRoute";
import { prepareHoldingsConsent, holdingsFailure } from "../../../../lib/plaidHoldings";
import { readLimitedJson } from "../../../../lib/requestSecurity";
import { PlaidOperationError } from "../../../../lib/plaidOperations";
export async function POST(request: Request) {
  return personalPlaidRoute(request, async (context) => {
    let body;
    try { body = await readLimitedJson(request); } catch { throw new PlaidOperationError("A small JSON connection request is required"); }
    if (typeof body.connection_id !== "string" || !["update", "separate"].includes(String(body.mode)) || Object.keys(body).some((key) => !["connection_id", "mode"].includes(key))) throw new PlaidOperationError("Select a saved connection and consent mode");
    try { return await prepareHoldingsConsent(context, body.connection_id, body.mode === "separate"); }
    catch (error) { if (error instanceof PlaidOperationError) throw error; throw new PlaidOperationError(holdingsFailure(error).message, 422); }
  });
}
