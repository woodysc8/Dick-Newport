import type { PlaidApi, Transaction } from "plaid";
import { PersonalFinanceCategoryVersion } from "plaid";

// Buffer a complete update; never checkpoint an intermediate page.
export async function collectTransactionSync(
  client: PlaidApi,
  accessToken: string,
  initialCursor: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let cursor = initialCursor;
    const added: Transaction[] = [],
      modified: Transaction[] = [];
    const removed: Array<{ transaction_id?: string }> = [];
    try {
      for (let page = 0; page < 100; page++) {
        const { data } = await client.transactionsSync({
          access_token: accessToken,
          cursor,
          count: 500,
          options: {
            personal_finance_category_version:
              PersonalFinanceCategoryVersion.V2,
          },
        });
        added.push(...data.added);
        modified.push(...data.modified);
        removed.push(...data.removed);
        if (added.length + modified.length + removed.length > 50000)
          throw new Error();
        cursor = data.next_cursor;
        if (!data.has_more) return { added, modified, removed, cursor };
      }
      throw new Error();
    } catch (error) {
      const code = (error as { response?: { data?: { error_code?: string } } })
        ?.response?.data?.error_code;
      if (
        code !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" ||
        attempt === 2
      )
        throw new Error("Transaction synchronization unavailable");
    }
  }
  throw new Error("Transaction synchronization unavailable");
}
