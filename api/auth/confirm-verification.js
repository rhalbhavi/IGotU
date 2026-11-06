import {
  HttpError,
  sendError,
  markUserVerifiedInIgotu,
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
      throw new HttpError(401, "Sign in to confirm verification.");
    }
    const idToken = authorization.slice(7);
    const decoded = await getFirebaseAuth().verifyIdToken(idToken);
    await markUserVerifiedInIgotu(decoded.uid, decoded.email);
    response.setHeader("Cache-Control", "private, no-store");
    response.status(200).json({
      success: true,
      verified: true,
      uid: decoded.uid,
      email: decoded.email
    });
  } catch (error) {
    sendError(response, error);
  }
}
