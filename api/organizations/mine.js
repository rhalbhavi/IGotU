import {
  getDatabase,
  HttpError,
  requireVerifiedUser,
  sendError
} from "../../lib/server.js";

export default async function handler(request, response) {
  try {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      throw new HttpError(405, "Method not allowed.");
    }
    const user = await requireVerifiedUser(request);
    const database = await getDatabase();
    const organizations = await database
      .collection("organizations")
      .find(
        { adminUids: user.uid },
        { projection: { adminUids: 0 } }
      )
      .sort({ updatedAt: -1 })
      .toArray();

    response.setHeader("Cache-Control", "private, no-store");
    response.status(200).json({
      organizations: organizations.map((organization) => ({
        slug: organization._id,
        name: organization.name,
        type: organization.type,
        published: organization.published,
        workspaceDomain: organization.workspaceDomain || "",
        address: organization.address || "",
        website: organization.website || "",
        contacts: organization.contacts,
        updatedAt: organization.updatedAt,
        history: organization.history || []
      }))
    });
  } catch (error) {
    sendError(response, error);
  }
}
