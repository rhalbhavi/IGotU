import {
  HttpError,
  requireVerifiedUser,
  sendError
} from "../../lib/server.js";

export default async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      throw new HttpError(405, "Method not allowed.");
    }
    const user = await requireVerifiedUser(request);
    response.setHeader("Cache-Control", "private, no-store");
    response.status(200).json({ domain: user.workspaceDomain, email: user.email });
  } catch (error) {
    sendError(response, error);
  }
}
