import {
  HttpError,
  sendError,
  verifyGoogleWorkspaceToken
} from "../../../lib/server.js";

export default async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      throw new HttpError(405, "Method not allowed.");
    }

    const identity = await verifyGoogleWorkspaceToken(request.body?.idToken);
    response.setHeader("Cache-Control", "private, no-store");
    response.status(200).json(identity);
  } catch (error) {
    sendError(response, error);
  }
}
