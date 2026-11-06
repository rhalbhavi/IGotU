import {
  HttpError,
  sendError,
  checkUserVerifiedInIgotu,
  getFirebaseAuth
} from "../../lib/server.js";

export default async function handler(request, response) {
  try {
    if (request.method !== "GET" && request.method !== "POST") {
      response.setHeader("Allow", "GET, POST");
      throw new HttpError(405, "Method not allowed.");
    }
    const authorization = request.headers.authorization || "";
    if (!authorization.startsWith("Bearer ")) {
      throw new HttpError(401, "Sign in to check verification status.");
    }
    const idToken = authorization.slice(7);
    const decoded = await getFirebaseAuth().verifyIdToken(idToken);
    const isVerified = await checkUserVerifiedInIgotu(decoded.uid, decoded);
    response.setHeader("Cache-Control", "private, no-store");
    response.status(200).json({
      verified: Boolean(isVerified),
      uid: decoded.uid,
      email: decoded.email
    });
  } catch (error) {
    sendError(response, error);
  }
}
