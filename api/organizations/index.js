import {
  getDatabase,
  HttpError,
  readOrganizationInput,
  requireVerifiedUser,
  sendError,
  validateSlug
} from "../../lib/server.js";

export default async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      throw new HttpError(405, "Method not allowed.");
    }
    const user = await requireVerifiedUser(request);
    if (request.body?.workspaceDomain !== user.workspaceDomain) {
      throw new HttpError(403, "The organization must use the same domain as your verified Google Workspace account.");
    }
    const slug = validateSlug(request.body?.slug);
    const settings = readOrganizationInput(request.body);
    const database = await getDatabase();
    const organization = {
      _id: slug,
      ...settings,
      published: false,
      workspaceDomain: user.workspaceDomain,
      createdByEmail: user.email || "",
      adminUids: [user.uid],
      createdAt: new Date(),
      updatedAt: new Date(),
      history: [{ actorUid: user.uid, actorEmail: user.email || "", action: "created", at: new Date() }]
    };
    try {
      await database.collection("organizations").insertOne(organization);
    } catch (error) {
      if (error.code === 11000) {
        throw new HttpError(409, "That page address is already in use. Choose another slug.");
      }
      throw error;
    }
    response.status(201).json({
      organization: {
        slug,
        name: organization.name,
        type: organization.type,
        published: organization.published,
        workspaceDomain: organization.workspaceDomain,
        address: organization.address,
        website: organization.website,
        contacts: organization.contacts,
        updatedAt: organization.updatedAt
      }
    });
  } catch (error) {
    sendError(response, error);
  }
}
