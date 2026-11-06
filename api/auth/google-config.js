export default function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    response.status(503).json({ error: "Google sign-in is not configured on the server." });
    return;
  }

  response.setHeader("Cache-Control", "public, max-age=300");
  response.status(200).json({ clientId });
}
