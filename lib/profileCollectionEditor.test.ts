import { describe, expect, it } from "vitest";
import { appendRecord, removeRecord, updateRecord } from "./profileCollectionEditor";

describe("collection editor operations", () => {
  it("adds multiple records, edits one without changing another, and removes only the selected record", () => {
    const initial = [
      { id: "income-a", name: "Primary job", amount: 3000 },
      { id: "income-b", name: "Weekend work", amount: undefined },
    ];
    const added = appendRecord(initial, { id: "income-c", name: "Contract", amount: 0 });
    const edited = updateRecord(added, "income-b", { amount: 450 });
    const removed = removeRecord(edited, "income-a");

    expect(added).toHaveLength(3);
    expect(edited).toMatchObject([{ id: "income-a", amount: 3000 }, { id: "income-b", amount: 450 }, { id: "income-c", amount: 0 }]);
    expect(removed.map(({ id }) => id)).toEqual(["income-b", "income-c"]);
    expect(initial[1].amount).toBeUndefined();
  });
});
