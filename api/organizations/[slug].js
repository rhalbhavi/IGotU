import {
  getDatabase,
  HttpError,
  publicOrganization,
  readOrganizationInput,
  requireVerifiedUser,
  sendError,
  validateSlug
} from "../../lib/server.js";

export default async function handler(request, response) {
  try {
    const slug = validateSlug(request.query.slug);
    const database = await getDatabase();
    const organizations = database.collection("organizations");

    if (request.method === "GET") {
      const organization = await organizations.findOne(
        { _id: slug, published: true },
        { projection: { adminUids: 0, history: 0 } }
      );
      if (!organization) throw new HttpError(404, "This organization's support page is not available.");
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ organization: publicOrganization(organization) });
      return;
    }

    if (request.method !== "PUT") {
      response.setHeader("Allow", "GET, PUT");
      throw new HttpError(405, "Method not allowed.");
    }

    const user = await requireVerifiedUser(request);
    const current = await organizations.findOne({ _id: slug, adminUids: user.uid });
    if (!current) throw new HttpError(404, "You do not have access to this organization.");

    const settings = readOrganizationInput(request.body);
    const published = request.body?.published;
    if (typeof published !== "boolean") {
      throw new HttpError(400, "Choose whether this page should be published.");
    }
    if (published && !Object.values(settings.contacts).some((contact) => contact.phone)) {
      throw new HttpError(400, "Add at least one local contact before publishing.");
    }
    if (current.workspaceDomain && current.workspaceDomain !== user.email.split("@")[1]?.toLowerCase()) {
      throw new HttpError(403, "Sign in with an account from this organization’s Google Workspace domain.");
    }

    const updatedAt = new Date();
    const historyEntry = {
      actorUid: user.uid,
      actorEmail: user.email || "",
      action: published === current.published ? "updated" : published ? "published" : "unpublished",
      at: updatedAt
    };
    const result = await organizations.findOneAndUpdate(
      { _id: slug, adminUids: user.uid },
      {
        $set: {
          ...settings,
          published,
          updatedAt,
        },
        $unset: { approvalStatus: "", approvalDetails: "", submittedAt: "", reviewedAt: "", reviewedBy: "", reviewNote: "" },
        $push: { history: { $each: [historyEntry], $slice: -50 } }
      },
      { returnDocument: "after", projection: { adminUids: 0, history: 0 } }
    );
    const organization = result?.value || result;
    if (!organization) throw new HttpError(404, "This organization could not be updated.");
    response.status(200).json({ organization: publicOrganization(organization) });
  } catch (error) {
    sendError(response, error);
  }
}
