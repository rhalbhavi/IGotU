import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { OAuth2Client } from "google-auth-library";
import { MongoClient } from "mongodb";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let mongoClientPromise;
const googleOAuthClient = new OAuth2Client();

function getFirebaseAuth() {
  if (getApps().length === 0) {
    const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } =
      process.env;
    if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
      throw new HttpError(503, "Firebase server authentication is not configured.");
    }
    initializeApp({
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      })
    });
  }
  return getAuth();
}

export async function getDatabase() {
  if (!process.env.MONGODB_URI) {
    throw new HttpError(503, "MongoDB Atlas is not configured.");
  }
  if (!mongoClientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI);
    mongoClientPromise = client.connect().catch((error) => {
      mongoClientPromise = undefined;
      throw error;
    });
  }
  const client = await mongoClientPromise;
  return client.db(process.env.MONGODB_DB || "igotu");
}

export async function requireVerifiedUser(request) {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) {
    throw new HttpError(401, "Sign in to continue.");
  }
  let user;
  try {
    user = await getFirebaseAuth().verifyIdToken(authorization.slice(7));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, "Your sign-in has expired. Sign in again.");
  }
  const emailDomain = user.email?.split("@")[1]?.toLowerCase();
  if (
    !user.email_verified ||
    user.firebase?.sign_in_provider !== "google.com" ||
    !emailDomain ||
    emailDomain === "gmail.com"
  ) {
    throw new HttpError(403, "Sign in with a verified Google Workspace account.");
  }
  const googleIdToken =
    request.headers["x-google-id-token"] ||
    request.headers["X-Google-ID-Token"];
  const workspace = await verifyGoogleWorkspaceToken(googleIdToken, user);
  return { ...user, workspaceDomain: workspace.domain };
}

export async function verifyGoogleWorkspaceToken(idToken, firebaseUser) {
  const audience = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!audience) {
    throw new HttpError(503, "Google Workspace verification is not configured on the server.");
  }
  if (typeof idToken !== "string" || !idToken) {
    throw new HttpError(400, "Sign in again with Google to verify your Workspace domain.");
  }

  let payload;
  try {
    const ticket = await googleOAuthClient.verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, "Google identity verification failed. Sign in again.");
  }

  const domain = payload?.hd?.toLowerCase();
  const email = payload?.email?.toLowerCase();
  const emailDomain = email?.split("@")[1];
  if (!payload?.email_verified || !domain || domain === "gmail.com" || emailDomain !== domain) {
    throw new HttpError(403, "Use a Google Workspace account managed by your organization’s domain. Personal Gmail accounts aren’t accepted.");
  }
  if (firebaseUser) {
    const firebaseAccount = await getFirebaseAuth().getUser(firebaseUser.uid);
    const googleProvider = firebaseAccount.providerData.find(
      (provider) => provider.providerId === "google.com"
    );
    if (
      !googleProvider ||
      googleProvider.uid !== payload.sub ||
      email !== firebaseUser.email?.toLowerCase()
    ) {
      throw new HttpError(403, "The Google Workspace account does not match your Firebase sign-in.");
    }
  }
  return { domain, email };
}

export function sendError(response, error) {
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  console.error("IGotU API request failed:", error);
  response.status(500).json({ error: "The request could not be completed." });
}

export function readOrganizationInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Provide organization settings.");
  }

  const name = readText(body.name, "Organization name", 2, 100);
  const types = ["residential", "campus", "educational", "public"];
  if (!types.includes(body.type)) {
    throw new HttpError(400, "Choose a valid organization type.");
  }
  if (!body.contacts || typeof body.contacts !== "object" || Array.isArray(body.contacts)) {
    throw new HttpError(400, "Provide contact settings.");
  }

  const address = readOptionalText(body.address, "Organization address", 250);
  const website = readOptionalUrl(body.website, "Organization website");
  const contacts = {};
  for (const key of ["security", "medical", "counselor"]) {
    const contact = body.contacts[key] || {};
    if (typeof contact !== "object" || Array.isArray(contact)) {
      throw new HttpError(400, `Invalid ${key} contact.`);
    }
    const label = readOptionalText(contact.label, `${key} contact name`, 60);
    const description = readOptionalText(contact.description, `${key} contact details`, 150);
    const phone = readPhone(contact.phone, `${key} contact phone`);
    if (Boolean(label) !== Boolean(phone)) {
      throw new HttpError(400, `Enter both the name and phone number for ${key}, or leave both blank.`);
    }
    contacts[key] = { label, phone, description };
  }

  return { name, type: body.type, address, website, contacts };
}

export function validateSlug(value) {
  if (
    typeof value !== "string" ||
    value.length > 48 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  ) {
    throw new HttpError(400, "Use a URL slug with lowercase letters, numbers, and single hyphens.");
  }
  return value;
}

export function publicOrganization(document) {
  return {
    slug: document._id,
    name: document.name,
    type: document.type,
    published: document.published,
    contacts: document.contacts
  };
}

function readText(value, name, minLength, maxLength) {
  if (typeof value !== "string") {
    throw new HttpError(400, `${name} is required.`);
  }
  const text = value.trim();
  if (text.length < minLength || text.length > maxLength) {
    throw new HttpError(400, `${name} must be between ${minLength} and ${maxLength} characters.`);
  }
  return text;
}

function readOptionalText(value, name, maxLength) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw new HttpError(400, `${name} must be at most ${maxLength} characters.`);
  }
  return value.trim();
}

function readPhone(value, name) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    throw new HttpError(400, `${name} must be a phone number.`);
  }
  const phone = value.trim();
  const digits = phone.replace(/\D/g, "");
  if (!/^\+?[0-9 ()-]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
    throw new HttpError(400, `${name} must contain 7–15 digits and only common phone-number characters.`);
  }
  return phone;
}

function readOptionalUrl(value, name) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.length > 500) {
    throw new HttpError(400, `${name} must be a valid HTTPS URL.`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, `${name} must be a valid HTTPS URL.`);
  }
  if (url.protocol !== "https:") {
    throw new HttpError(400, `${name} must use HTTPS.`);
  }
  return url.toString();
}
