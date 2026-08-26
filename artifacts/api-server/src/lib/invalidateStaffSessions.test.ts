import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@workspace/db/schema", () => ({
  portalSessionsTable: {
    token: "token",
    scope: "scope",
    subjectId: "subject_id",
  },
}));

const invalidateStaffAuthCache = vi.fn();
vi.mock("../middleware/requireStaffAuth", () => ({
  invalidateStaffAuthCache: (...args: unknown[]) => invalidateStaffAuthCache(...args),
}));

import { db } from "@workspace/db";
import { invalidateStaffSessionsForUser } from "./invalidateStaffSessions";

type MockFn = ReturnType<typeof vi.fn>;

function mockSelectReturning(rows: Array<{ token: string }>) {
  const limitChain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
  // select() returns object with from().where()
  (db.select as MockFn).mockReturnValue(limitChain);
  return limitChain;
}

function mockDelete() {
  const where = vi.fn().mockResolvedValue(undefined);
  (db.delete as MockFn).mockReturnValue({ where });
  return where;
}

describe("invalidateStaffSessionsForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revokes all sessions when keepToken is omitted (admin PIN reset)", async () => {
    mockSelectReturning([{ token: "a" }, { token: "b" }]);
    const deleteWhere = mockDelete();

    const revoked = await invalidateStaffSessionsForUser(42);

    expect(revoked).toBe(2);
    expect(invalidateStaffAuthCache).toHaveBeenCalledWith("a");
    expect(invalidateStaffAuthCache).toHaveBeenCalledWith("b");
    expect(deleteWhere).toHaveBeenCalled();
  });

  it("keeps the caller's token and revokes every other session", async () => {
    mockSelectReturning([{ token: "keep-me" }, { token: "stolen" }]);
    const deleteWhere = mockDelete();

    const revoked = await invalidateStaffSessionsForUser(7, { keepToken: "keep-me" });

    expect(revoked).toBe(1);
    expect(invalidateStaffAuthCache).toHaveBeenCalledTimes(1);
    expect(invalidateStaffAuthCache).toHaveBeenCalledWith("stolen");
    expect(invalidateStaffAuthCache).not.toHaveBeenCalledWith("keep-me");
    expect(deleteWhere).toHaveBeenCalled();
  });
});
