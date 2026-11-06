import test from "node:test";
import assert from "node:assert/strict";
import {
  HttpError,
  publicOrganization,
  readOrganizationInput,
  readPhone,
  validateSlug
} from "../lib/server.js";

const emptyContacts = {
  security: { label: "", phone: "", description: "" },
  medical: { label: "", phone: "", description: "" },
  counselor: { label: "", phone: "", description: "" }
};

test("accepts and normalizes organization settings", () => {
  const settings = readOrganizationInput({
    name: "  Cedar Apartments ",
    type: "residential",
    contacts: {
      ...emptyContacts,
      security: {
        label: "  Front Desk ",
        phone: "+91 (98765) 43210",
        description: "  Call any time "
      }
    }
  });
  assert.deepEqual(settings, {
    name: "Cedar Apartments",
    type: "residential",
    address: "",
    website: "",
    contacts: {
      ...emptyContacts,
      security: {
        label: "Front Desk",
        phone: "+91 (98765) 43210",
        description: "Call any time"
      }
    }
  });
});

test("requires both a contact name and phone number", () => {
  assert.throws(
    () =>
      readOrganizationInput({
        name: "Cedar Apartments",
        type: "residential",
        contacts: {
          ...emptyContacts,
          security: { label: "Front Desk", phone: "", description: "" }
        }
      }),
    (error) => error instanceof HttpError && error.status === 400
  );
});

test("rejects invalid organization types and phone values", () => {
  assert.throws(
    () => readOrganizationInput({ name: "Cedar Apartments", type: "other", contacts: emptyContacts }),
    (error) => error instanceof HttpError && error.status === 400
  );
  assert.throws(
    () =>
      readOrganizationInput({
        name: "Cedar Apartments",
        type: "residential",
        contacts: {
          ...emptyContacts,
          medical: { label: "Clinic", phone: "1234", description: "" }
        }
      }),
    (error) => error instanceof HttpError && error.status === 400
  );
});

test("validates country-specific phone number length and format", () => {
  // India (+91): exactly 10 digits
  assert.equal(readPhone("+91 9876543210", "Phone"), "+91 9876543210");
  assert.throws(() => readPhone("+91 987654321", "Phone"), /10 digits/);
  assert.throws(() => readPhone("+91 98765432100", "Phone"), /10 digits/);

  // USA & Canada (+1): exactly 10 digits
  assert.equal(readPhone("+1 2025550123", "Phone"), "+1 2025550123");
  assert.throws(() => readPhone("+1 202555012", "Phone"), /10 digits/);
  assert.throws(() => readPhone("+1 20255501234", "Phone"), /10 digits/);

  // UK (+44): 10 or 11 digits
  assert.equal(readPhone("+44 7911123456", "Phone"), "+44 7911123456");
  assert.equal(readPhone("+44 79111234567", "Phone"), "+44 79111234567");
  assert.throws(() => readPhone("+44 791112345", "Phone"), /10 or 11 digits/);
  assert.throws(() => readPhone("+44 791112345678", "Phone"), /10 or 11 digits/);

  // Australia (+61): exactly 9 digits
  assert.equal(readPhone("+61 412345678", "Phone"), "+61 412345678");
  assert.throws(() => readPhone("+61 41234567", "Phone"), /9 digits/);
  assert.throws(() => readPhone("+61 4123456789", "Phone"), /9 digits/);

  // Germany (+49): 10 or 11 digits
  assert.equal(readPhone("+49 1512345678", "Phone"), "+49 1512345678");
  assert.equal(readPhone("+49 15123456789", "Phone"), "+49 15123456789");
  assert.throws(() => readPhone("+49 151234567", "Phone"), /10 or 11 digits/);
  assert.throws(() => readPhone("+49 151234567890", "Phone"), /10 or 11 digits/);
});

test("accepts only lowercase hyphenated slugs", () => {
  assert.equal(validateSlug("cedar-apartments-2"), "cedar-apartments-2");
  for (const slug of ["", "Cedar", "-cedar", "cedar-", "cedar--apartments", "cedar/apartments"]) {
    assert.throws(() => validateSlug(slug), (error) => error instanceof HttpError);
  }
});

test("public organization output excludes admin and audit data", () => {
  const result = publicOrganization({
    _id: "cedar-apartments",
    name: "Cedar Apartments",
    type: "residential",
    published: true,
    contacts: emptyContacts,
    adminUids: ["private-user-id"],
    history: [{ actorEmail: "admin@example.com" }]
  });
  assert.deepEqual(Object.keys(result).sort(), ["contacts", "name", "published", "slug", "type"]);
});

test("requires bearer token for verified user access", async () => {
  const { requireVerifiedUser } = await import("../lib/server.js");
  await assert.rejects(
    () => requireVerifiedUser({ headers: {} }),
    (error) => error instanceof HttpError && error.status === 401
  );
  await assert.rejects(
    () => requireVerifiedUser({ headers: { authorization: "Basic 123" } }),
    (error) => error instanceof HttpError && error.status === 401
  );
});
