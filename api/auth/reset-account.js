import {
  HttpError,
  sendError,
  resetAccountData,
  getFirebaseAuth
} from "../../lib/server.js";

export default async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      throw new HttpError(405, "Method not allowed.");
    }
    const authorization = request.headers.authorization || "";
    if (!authorization.startsWith("Bearer ")) {
      throw new HttpError(401, "Sign in to reset account.");
    }
    const idToken = authorization.slice(7);
    const decoded = await getFirebaseAuth().verifyIdToken(idToken);
    await resetAccountData(decoded.email, decoded.uid);
    response.setHeader("Cache-Control", "private, no-store");
    response.status(200).json({ success: true, reset: true });
  } catch (error) {
    sendError(response, error);
  }
}
