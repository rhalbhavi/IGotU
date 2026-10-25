import test from "node:test";
import assert from "node:assert/strict";
import {
  HttpError,
  publicOrganization,
  readOrganizationInput,
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
