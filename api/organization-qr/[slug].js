import QRCode from "qrcode";
import { getDatabase, HttpError, sendError, validateSlug } from "../../lib/server.js";

export default async function handler(request, response) {
  try {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      throw new HttpError(405, "Method not allowed.");
    }
    const slug = validateSlug(request.query.slug);
    const publicSiteUrl = process.env.PUBLIC_SITE_URL;
    if (!publicSiteUrl) {
      throw new HttpError(503, "Set PUBLIC_SITE_URL in your hosting environment to enable QR downloads.");
    }
    let baseUrl;
    try {
      baseUrl = new URL(publicSiteUrl);
    } catch {
      throw new HttpError(503, "PUBLIC_SITE_URL must be a valid absolute URL.");
    }
    if (!["https:", "http:"].includes(baseUrl.protocol)) {
      throw new HttpError(503, "PUBLIC_SITE_URL must use HTTP or HTTPS.");
    }
    const database = await getDatabase();
    const organization = await database.collection("organizations").findOne({
      _id: slug,
      published: true
    });
    if (!organization) throw new HttpError(404, "Publish this support page before downloading its QR code.");

    const publicPageUrl = new URL("/", baseUrl);
    publicPageUrl.pathname = `/support/${slug}`;
    const svg = await QRCode.toString(publicPageUrl.toString(), {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      color: { dark: "#18312e", light: "#ffffff" }
    });
    response.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    if (request.query.inline !== "1") {
      response.setHeader("Content-Disposition", `attachment; filename="${slug}-igotu-qr.svg"`);
    } else {
      response.setHeader("Content-Disposition", "inline");
    }
    response.setHeader("Cache-Control", "public, max-age=300");
    response.status(200).send(svg);
  } catch (error) {
    sendError(response, error);
  }
}
