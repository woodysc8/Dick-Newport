import { expect, it, vi } from "vitest";
import type { PlaidApi } from "plaid";
import { collectTransactionSync } from "./transactionSyncBatch";
const page = (cursor: string, has_more = false) => ({
  data: { added: [], modified: [], removed: [], next_cursor: cursor, has_more },
});
it("restarts pagination from the original cursor and discards the interrupted batch", async () => {
  const sync = vi
    .fn()
    .mockResolvedValueOnce({
      ...page("intermediate", true),
      data: {
        ...page("intermediate", true).data,
        added: [{ transaction_id: "discarded" }],
      },
    })
    .mockRejectedValueOnce({
      response: {
        data: { error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" },
      },
    })
    .mockResolvedValueOnce(page("terminal"));
  const result = await collectTransactionSync(
    { transactionsSync: sync } as unknown as PlaidApi,
    "synthetic",
    "initial",
  );
  expect(sync.mock.calls.map(([input]) => input.cursor)).toEqual([
    "initial",
    "intermediate",
    "initial",
  ]);
  expect(result).toEqual({
    added: [],
    modified: [],
    removed: [],
    cursor: "terminal",
  });
});
it("bounds retries and sanitizes SDK failures", async () => {
  const sync = vi
    .fn()
    .mockRejectedValue({
      response: {
        data: {
          error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
          error_message: "private-provider",
        },
      },
    });
  await expect(
    collectTransactionSync(
      { transactionsSync: sync } as unknown as PlaidApi,
      "synthetic",
      "initial",
    ),
  ).rejects.toThrow("Transaction synchronization unavailable");
  expect(sync).toHaveBeenCalledTimes(3);
});
