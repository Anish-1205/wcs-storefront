import { describe, expect, it, vi, beforeEach } from "vitest";

const mockAssertAdmin = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-auth", () => ({ assertAdmin: mockAssertAdmin }));
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: mockRevalidatePath,
}));

import { saveContact, deleteContact, listContacts, exportContactsCsv } from "@/app/admin/actions";
import type { ContactInputShape } from "@/lib/validation";

/**
 * The contacts CRM is fed by manual entry, inquiries and subscribers, so the
 * behaviour that matters is de-duplication by phone and that the filter strings
 * handed to PostgREST can't be broken by ordinary punctuation.
 */
function fakeAdmin(rows: any[] = []) {
  const calls: Array<{ op: string; table: string; args: unknown[]; filters: unknown[] }> = [];
  let matchRow: any = null;

  function builder(table: string, op: string, args: unknown[]) {
    const filters: unknown[] = [];
    const record = { op, table, args, filters };
    calls.push(record);
    const self: any = {
      eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), self),
      in: (c: string, v: unknown) => (filters.push(["in", c, v]), self),
      or: (expr: string) => (filters.push(["or", expr]), self),
      order: (c: string, o: unknown) => (filters.push(["order", c, o]), self),
      select: () => self,
      single: async () => ({ data: { id: "new-id" }, error: null }),
      maybeSingle: async () => ({ data: matchRow, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
    };
    return self;
  }

  const admin = {
    from: (table: string) => ({
      select: (...a: unknown[]) => builder(table, "select", a),
      insert: (...a: unknown[]) => builder(table, "insert", a),
      update: (...a: unknown[]) => builder(table, "update", a),
      delete: (...a: unknown[]) => builder(table, "delete", a),
    }),
  };

  return {
    admin,
    calls,
    setExistingMatch: (row: any) => {
      matchRow = row;
    },
  };
}

function contactInput(overrides: Partial<ContactInputShape> = {}): ContactInputShape {
  return {
    name: "Asha Rao",
    phone: "+919876543210",
    role: "customer",
    status_tag: "regular",
    city: "Hyderabad",
    source: "manual",
    whatsapp_opt_in: true,
    rating: null,
    notes: null,
    last_contacted_at: null,
    next_follow_up_on: null,
    ...overrides,
  } as ContactInputShape;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveContact", () => {
  it("refuses a non-admin", async () => {
    mockAssertAdmin.mockRejectedValue(new Error("Unauthorized"));
    expect(await saveContact(contactInput())).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("rejects an invalid phone without touching the database", async () => {
    const { admin, calls } = fakeAdmin();
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    const result = await saveContact(contactInput({ phone: "nope" }));

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("inserts a new contact when no existing phone matches", async () => {
    const { admin, calls } = fakeAdmin();
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    const result = await saveContact(contactInput());

    expect(result).toMatchObject({ ok: true, id: "new-id" });
    expect(calls.some((c) => c.op === "insert" && c.table === "contacts")).toBe(true);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/contacts");
  });

  it("updates the existing contact instead of creating a duplicate phone", async () => {
    const { admin, calls, setExistingMatch } = fakeAdmin();
    setExistingMatch({ id: "existing-1" });
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    const result = await saveContact(contactInput());

    expect(result).toMatchObject({ ok: true, id: "existing-1" });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
    const update = calls.find((c) => c.op === "update");
    expect(update?.filters).toContainEqual(["eq", "id", "existing-1"]);
  });

  it("looks a phone up by both its raw and normalised form", async () => {
    const { admin, calls } = fakeAdmin();
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    await saveContact(contactInput({ phone: "+91 98765-43210" }));

    const lookup = calls.find((c) => c.op === "select" && c.table === "contacts");
    expect(lookup?.filters).toContainEqual(["in", "phone", ["+91 98765-43210", "+919876543210"]]);
  });

  it("does not build an .or() filter string from a parenthesised phone number", async () => {
    const { admin, calls } = fakeAdmin();
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    // Parentheses are valid per contactPhoneRegex but are PostgREST .or() syntax.
    const result = await saveContact(contactInput({ phone: "+1 (555) 123-4567" }));

    expect(result.ok).toBe(true);
    expect(calls.flatMap((c) => c.filters).some((f: any) => f[0] === "or")).toBe(false);
  });

  it("updates directly by id when one is supplied, skipping the phone lookup", async () => {
    const { admin, calls } = fakeAdmin();
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    const result = await saveContact(
      contactInput({ id: "11111111-1111-4111-8111-111111111111" }),
    );

    expect(result).toMatchObject({ ok: true, id: "11111111-1111-4111-8111-111111111111" });
    expect(calls.some((c) => c.op === "select")).toBe(false);
  });
});

describe("deleteContact", () => {
  it("deletes by id and refreshes the list", async () => {
    const { admin, calls } = fakeAdmin();
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    const result = await deleteContact("c1");

    expect(result).toMatchObject({ ok: true });
    const del = calls.find((c) => c.op === "delete");
    expect(del?.filters).toContainEqual(["eq", "id", "c1"]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/contacts");
  });
});

describe("listContacts", () => {
  it("neutralises PostgREST filter syntax in the search box", async () => {
    const { admin, calls } = fakeAdmin();
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    await listContacts({ q: "rao,role.eq.supplier" });

    const or = calls[0].filters.find((f: any) => f[0] === "or") as [string, string];
    // The comma that would have grafted on an extra filter is gone.
    expect(or[1]).not.toContain("rao,role.eq.supplier");
    expect(or[1]).toContain("rao role.eq.supplier");
  });

  it("escapes ILIKE wildcards so a literal % is not a match-all", async () => {
    const { admin, calls } = fakeAdmin();
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    await listContacts({ q: "50%_off" });

    const or = calls[0].filters.find((f: any) => f[0] === "or") as [string, string];
    expect(or[1]).toContain("50\\%\\_off");
  });

  it("applies role, status and source filters and the requested sort", async () => {
    const { admin, calls } = fakeAdmin();
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    await listContacts({ role: "supplier", status_tag: "priority", source: "inquiry", sort: "name", dir: "asc" });

    expect(calls[0].filters).toContainEqual(["eq", "role", "supplier"]);
    expect(calls[0].filters).toContainEqual(["eq", "status_tag", "priority"]);
    expect(calls[0].filters).toContainEqual(["eq", "source", "inquiry"]);
    expect(calls[0].filters).toContainEqual(["order", "name", { ascending: true }]);
  });

  it("omits the search filter entirely when the box is empty", async () => {
    const { admin, calls } = fakeAdmin();
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    await listContacts({});

    expect(calls[0].filters.some((f: any) => f[0] === "or")).toBe(false);
  });
});

describe("exportContactsCsv", () => {
  it("quotes and escapes values so a comma or quote can't shift a column", async () => {
    const { admin } = fakeAdmin([
      {
        name: 'Rao, Asha "Ashu"',
        phone: "+919876543210",
        role: "customer",
        status_tag: "regular",
        city: null,
        source: "manual",
        whatsapp_opt_in: true,
        rating: null,
        notes: "line one",
        last_contacted_at: null,
        next_follow_up_on: null,
      },
    ]);
    mockAssertAdmin.mockResolvedValue({ admin, user: {} });

    const result = await exportContactsCsv({});

    expect(result.ok).toBe(true);
    const csv = (result as { csv: string }).csv;
    const [header, row] = csv.split("\n");
    expect(header.split(",")[0]).toBe("name");
    expect(row).toContain('"Rao, Asha ""Ashu"""');
  });
});
