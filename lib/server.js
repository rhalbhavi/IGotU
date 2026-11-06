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

// Define a global variable to hold the MongoClient promise - which is used for caching the connection across function invocations in serverless environments.
let mongoClientPromise;
const googleOAuthClient = new OAuth2Client();

// Initialize Firebase Admin SDK only once and return the Auth instance.
export function getFirebaseAuth() {
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

// Get a MongoDB database connection, caching the client for reuse.
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

export async function checkUserVerifiedInIgotu(uid, decodedUser = null) {
  if (decodedUser?.igotu_verified) {
    return true;
  }
  try {
    const auth = getFirebaseAuth();
    const user = await auth.getUser(uid);
    if (user?.customClaims?.igotu_verified) {
      return true;
    }
  } catch {
    // Firebase auth may not be configured or user not found
  }

  try {
    const db = await getDatabase();
    if (db) {
      const record = await db.collection("verified_admins").findOne({ _id: uid, verified: true });
      if (record) return true;
    }
  } catch {
    // MongoDB Atlas may not be configured
  }

  return false;
}

export async function resetAccountData(email, newUid) {
  // Called when a previously-deleted Firebase account signs in again with the same email.
  // Removes any stale verified_admins records tied to the email (regardless of old UID),
  // and also removes any record for the new UID if it somehow already exists.
  try {
    const db = await getDatabase();
    if (db) {
      const filter = { $or: [] };
      if (email) filter.$or.push({ email: (email || "").toLowerCase() });
      if (newUid) filter.$or.push({ _id: newUid });
      if (filter.$or.length > 0) {
        await db.collection("verified_admins").deleteMany(filter);
      }
    }
  } catch (err) {
    console.warn("resetAccountData MongoDB notice:", err?.message || err);
  }

  // Also revoke the Firebase custom claim if the new UID exists in Firebase Auth.
  if (newUid) {
    try {
      const auth = getFirebaseAuth();
      const user = await auth.getUser(newUid);
      if (user?.customClaims?.igotu_verified) {
        await auth.setCustomUserClaims(newUid, {
          ...(user.customClaims || {}),
          igotu_verified: false
        });
      }
    } catch {
      // User may not exist in Firebase or Auth may not be configured — ignore
    }
  }
}

export async function markUserVerifiedInIgotu(uid, email) {
  try {
    const auth = getFirebaseAuth();
    const user = await auth.getUser(uid);
    await auth.setCustomUserClaims(uid, {
      ...(user?.customClaims || {}),
      igotu_verified: true
    });
  } catch (err) {
    console.warn("setCustomUserClaims notice:", err?.message || err);
  }

  try {
    const db = await getDatabase();
    if (db) {
      await db.collection("verified_admins").updateOne(
        { _id: uid },
        {
          $set: {
            email: (email || "").toLowerCase(),
            verified: true,
            verifiedAt: new Date()
          }
        },
        { upsert: true }
      );
    }
  } catch (err) {
    console.warn("MongoDB mark verified notice:", err?.message || err);
  }
  return true;
}

// Require a verified user from the request headers, checking for a valid Firebase ID token and Google Workspace verification if applicable.
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
  if (!emailDomain || ["gmail.com", "googlemail.com"].includes(emailDomain)) {
    await getFirebaseAuth().deleteUser(user.uid).catch(() => {});
    throw new HttpError(403, "Use a verified organization email address. Personal Gmail accounts aren't accepted.");
  }
  if (!user.email_verified) {
    throw new HttpError(403, "Verify your organization email address before accessing the dashboard.");
  }
  const isVerifiedInIgotu = await checkUserVerifiedInIgotu(user.uid, user);
  if (!isVerifiedInIgotu) {
    throw new HttpError(403, "Verify your organization email address before accessing the dashboard.");
  }
  // Check if the user signed in with Google Workspace or has a Google ID token for verification.
  const signInProvider = user.firebase?.sign_in_provider;
  const googleIdToken =
    request.headers["x-google-id-token"] ||
    request.headers["X-Google-ID-Token"];
  if (signInProvider === "google.com" || googleIdToken) {
    try {
      const workspace = await verifyGoogleWorkspaceToken(googleIdToken, user);
      return { ...user, workspaceDomain: workspace.domain };
    } catch (error) {
      await getFirebaseAuth().deleteUser(user.uid).catch(() => {});
      throw error;
    }
  }
  if (signInProvider === "password") {
    const approvedEmailDomains = (process.env.ORGANIZATION_EMAIL_DOMAINS || "")
      .split(",")
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean);
    if (!approvedEmailDomains.includes(emailDomain)) {
      await getFirebaseAuth().deleteUser(user.uid).catch(() => {});
      throw new HttpError(403, "Email sign-in isn't enabled for this organization domain.");
    }
    return { ...user, workspaceDomain: emailDomain };
  }
  await getFirebaseAuth().deleteUser(user.uid).catch(() => {});
  throw new HttpError(403, "Sign in with Google Workspace or verify your organization email address.");
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
  if (
    !payload?.email_verified ||
    !domain ||
    ["gmail.com", "googlemail.com"].includes(domain) ||
    emailDomain !== domain
  ) {
    throw new HttpError(403, "Use a Google Workspace account managed by your organization's domain. Personal Gmail accounts aren't accepted.");
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

// Read/validate organization input from the request body
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

// Read/validate a text input for the org page from the request body
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
// Read/validate an optional text input for the org page from the request body
function readOptionalText(value, name, maxLength) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw new HttpError(400, `${name} must be at most ${maxLength} characters.`);
  }
  return value.trim();
}

// Read/validate phone number input from the request body
export function readPhone(value, name) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    throw new HttpError(400, `${name} must be a phone number.`);
  }
  const phone = value.trim();
  if (!/^\+?[0-9 ()-]+$/.test(phone)) {
    throw new HttpError(400, `${name} must contain only digits and common phone-number characters.`);
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    throw new HttpError(400, `${name} must contain 7-15 digits.`);
  }

  if (phone.startsWith("+91")) {
    const localDigits = phone.slice(3).replace(/\D/g, "");
    if (localDigits.length !== 10) {
      throw new HttpError(400, `${name} must be 10 digits long for India (+91).`);
    }
  } else if (phone.startsWith("+44")) {
    const localDigits = phone.slice(3).replace(/\D/g, "");
    if (localDigits.length !== 10 && localDigits.length !== 11) {
      throw new HttpError(400, `${name} must be 10 or 11 digits long for UK (+44).`);
    }
  } else if (phone.startsWith("+61")) {
    const localDigits = phone.slice(3).replace(/\D/g, "");
    if (localDigits.length !== 9) {
      throw new HttpError(400, `${name} must be 9 digits long for Australia (+61).`);
    }
  } else if (phone.startsWith("+49")) {
    const localDigits = phone.slice(3).replace(/\D/g, "");
    if (localDigits.length !== 10 && localDigits.length !== 11) {
      throw new HttpError(400, `${name} must be 10 or 11 digits long for Germany (+49).`);
    }
  } else if (phone.startsWith("+1")) {
    const localDigits = phone.slice(2).replace(/\D/g, "");
    if (localDigits.length !== 10) {
      throw new HttpError(400, `${name} must be 10 digits long for USA/Canada (+1).`);
    }
  }

  return phone;
}

// Read/validate an optional HTTPS URL input for the org page from the request body
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
