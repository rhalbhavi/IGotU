import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
  applyActionCode,
  checkActionCode,
  GoogleAuthProvider,
  getAuth,
  getRedirectResult,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendEmailVerification,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const status = document.querySelector("#admin-status");
const authStatus = document.querySelector("#auth-status");
const authPanel = document.querySelector("#auth-panel");
const dashboard = document.querySelector("#dashboard");
const emailSignInButton = document.querySelector("#email-sign-in");
const emailSignInForm = document.querySelector("#email-sign-in-form");
const emailSignInAddress = document.querySelector("#email-sign-in-address");
const organizationForm = document.querySelector("#organization-form");
const createOrganizationForm = document.querySelector("#create-org-form");
let auth;
let organizations = [];
let selectedOrganization;
let slugManuallyEdited = false;
let workspaceIdToken = "";
let workspaceDomain = "";
const placeSearches = new Set();
let nominatimQueue = Promise.resolve();
let lastNominatimRequestAt = 0;
const emailForSignInStorageKey = "igotu-email-for-sign-in";
const googleVerificationStorageKey = "igotu-google-verification-email";
const osmPlaceProvider = window.GeoSearch
  ? new window.GeoSearch.OpenStreetMapProvider({
      params: { limit: 8, "accept-language": document.documentElement.lang || "en" }
    })
  : null;

document.querySelector("#slug-origin").textContent = `${window.location.origin}/`;

if (!isFirebaseConfigured) {
  status.textContent = "Admin setup is temporarily unavailable. Please try again later.";
  authPanel.hidden = true;
} else {
  auth = getAuth(initializeApp(firebaseConfig));
  onAuthStateChanged(auth, handleAuthState);
  if (isSignInWithEmailLink(auth, window.location.href)) {
    emailSignInForm.hidden = false;
    const savedEmail = localStorage.getItem(emailForSignInStorageKey);
    if (savedEmail) {
      emailSignInAddress.value = savedEmail;
      completeEmailLinkSignIn(savedEmail);
    } else {
      setStatus("Enter the organization email address that received the sign-in link.", "error");
    }
  } else if (
    new URLSearchParams(window.location.search).get("finish") === "google-email-verification" ||
    new URLSearchParams(window.location.search).get("mode") === "verifyEmail"
  ) {
    continueGoogleSignInAfterEmailVerification();
  } else {
    finishGoogleRedirectSignIn();
  }
}

document.querySelector("#google-sign-in").addEventListener("click", signInToWorkspace);
document.querySelector("#refresh-google-session").addEventListener("click", signInToWorkspace);
emailSignInButton.addEventListener("click", () => {
  emailSignInForm.hidden = false;
  emailSignInAddress.focus();
});
emailSignInForm.addEventListener("submit", handleEmailSignIn);

async function signInToWorkspace() {
  if (!auth) return;
  const alreadyVerified = Boolean(workspaceIdToken);
  if (!alreadyVerified) {
    await signOut(auth).catch(() => {});
  }
  setStatus("Opening Google sign-in…");
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const credential = await signInWithPopup(auth, provider);
    const googleEmailDomain = credential.user.email?.toLowerCase().split("@").pop();
    if (googleEmailDomain === "gmail.com" || googleEmailDomain === "googlemail.com") {
      throw new Error("Use your organization's Google Workspace account. Personal Gmail accounts aren't accepted.");
    }
    const googleCredential = GoogleAuthProvider.credentialFromResult(credential);
    if (!googleCredential?.idToken) {
      throw new Error("Google did not return an identity token. Check the Firebase Google provider setup.");
    }
    await sendEmailVerification(credential.user, {
      url: `${window.location.origin}${window.location.pathname}?finish=google-email-verification`,
      handleCodeInApp: true
    });
    localStorage.setItem(googleVerificationStorageKey, credential.user.email?.toLowerCase() || "");
    workspaceIdToken = "";
    workspaceDomain = "";
    await signOut(auth);
    setStatus("Verification email sent. Click its link to verify your email and finish signing in with Google.");
  } catch (error) {
    const popupWasClosed = ["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(error.code);
    if (popupWasClosed || !alreadyVerified) {
      workspaceIdToken = "";
      workspaceDomain = "";
      await signOut(auth).catch(() => {});
    }
    const message = error.code === "auth/unauthorized-domain"
      ? `This site (${window.location.hostname}) is not authorized for Firebase sign-in. Add this hostname in Firebase Console under Authentication → Settings → Authorized domains, then try again.`
      : error.message || "Google sign-in failed.";
    setStatus(popupWasClosed
      ? "Google sign-in cancelled. Click Continue with Google to choose an account."
      : message, "error");
  }
}

async function handleEmailSignIn(event) {
  event.preventDefault();
  if (!auth) return;
  const email = emailSignInAddress.value.trim().toLowerCase();
  const emailDomain = email.split("@").pop();
  if (!email || emailDomain === "gmail.com" || emailDomain === "googlemail.com") {
    setStatus("Use your organization's email address. Personal Gmail accounts aren't accepted.", "error");
    return;
  }

  try {
    if (isSignInWithEmailLink(auth, window.location.href)) {
      await completeEmailLinkSignIn(email);
      return;
    }
    localStorage.setItem(emailForSignInStorageKey, email);
    await sendSignInLinkToEmail(auth, email, {
      url: `${window.location.origin}${window.location.pathname}`,
      handleCodeInApp: true
    });
    setStatus("Verification email sent. Open its sign-in link to verify your address and continue.");
  } catch (error) {
    if (error.code === "auth/operation-not-allowed") {
      setStatus("Email sign-in is not enabled for this project yet.", "error");
    } else {
      setStatus(error.message || "Could not send the verification email.", "error");
    }
  }
}

async function continueGoogleSignInAfterEmailVerification() {
  const params = new URLSearchParams(window.location.search);
  const actionCode = params.get("oobCode");
  try {
    if (actionCode && params.get("mode") === "verifyEmail") {
      const action = await checkActionCode(auth, actionCode);
      await applyActionCode(auth, actionCode);
      if (action.data.email) {
        localStorage.setItem(googleVerificationStorageKey, action.data.email.toLowerCase());
      }
    }
    window.history.replaceState({}, document.title, window.location.pathname);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithRedirect(auth, provider);
  } catch (error) {
    setStatus(error.message || "Email verification failed. Request a new verification email.", "error");
  }
}

async function finishGoogleRedirectSignIn() {
  try {
    const credential = await getRedirectResult(auth);
    if (!credential) return;
    const expectedEmail = localStorage.getItem(googleVerificationStorageKey);
    const actualEmail = credential.user.email?.toLowerCase() || "";
    if (expectedEmail && actualEmail !== expectedEmail) {
      await signOut(auth);
      setStatus("Choose the Google account whose email address you verified.", "error");
      return;
    }
    const googleCredential = GoogleAuthProvider.credentialFromResult(credential);
    if (!googleCredential?.idToken) {
      throw new Error("Google did not return an identity token. Try signing in again.");
    }
    localStorage.removeItem(googleVerificationStorageKey);
    workspaceIdToken = googleCredential.idToken;
    await connectSignedInUser(credential.user);
  } catch (error) {
    setStatus(error.message || "Google sign-in could not be completed.", "error");
  }
}

async function completeEmailLinkSignIn(email) {
  try {
    const credential = await signInWithEmailLink(auth, email, window.location.href);
    localStorage.removeItem(emailForSignInStorageKey);
    window.history.replaceState({}, document.title, window.location.pathname);
    await connectSignedInUser(credential.user);
  } catch (error) {
    await signOut(auth).catch(() => {});
    setStatus(error.message || "That sign-in link is invalid or expired. Request a new one.", "error");
  }
}

async function connectSignedInUser(user) {
  const result = await apiRequest("/api/auth/workspace", "POST");
  workspaceDomain = result.domain;
  dashboard.hidden = false;
  authPanel.hidden = true;
  initializePlaceSearch("create-place", (place) => {
    document.querySelector("#new-org-address").value = place.address;
    const nameInput = document.querySelector("#new-org-name");
    if (!nameInput.value.trim()) {
      nameInput.value = place.name;
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  initializePlaceSearch("edit-place", (place) => {
    document.querySelector("#organization-address").value = place.address;
  });
  document.querySelector("#account-email").textContent = user.email || "";
  const refreshButton = document.querySelector("#refresh-google-session");
  refreshButton.textContent = user.providerData.some((provider) => provider.providerId === "password")
    ? "Sign in with Google"
    : "Refresh Google session";
  await loadOrganizations();
  setStatus("Signed in with your organization's verified email.");
}

document.querySelector("#sign-out").addEventListener("click", () => signOut(auth));

document.querySelector("#new-org-name").addEventListener("input", (event) => {
  if (slugManuallyEdited) return;
  document.querySelector("#new-org-slug").value = slugify(event.currentTarget.value);
});
document.querySelector("#new-org-slug").addEventListener("input", () => {
  slugManuallyEdited = true;
});

createOrganizationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {
    name: document.querySelector("#new-org-name").value.trim(),
    slug: document.querySelector("#new-org-slug").value.trim(),
    type: document.querySelector("#new-org-type").value,
    address: document.querySelector("#new-org-address").value.trim(),
    contacts: emptyContacts()
  };
  try {
    if (!workspaceDomain) {
      throw new Error("Sign in again with your verified organization account.");
    }
    setStatus("Creating your organization page…");
    await apiRequest("/api/organizations", "POST", {
      ...body,
      workspaceDomain
    });
    await loadOrganizations(body.slug);
    setStatus("Organization created. Add its local contacts and save or publish the page.");
    createOrganizationForm.reset();
    slugManuallyEdited = false;
  } catch (error) {
    setStatus(error.message);
  }
});

organizationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedOrganization) return;
  try {
    setStatus("Saving organization settings…");
    const body = {
      name: document.querySelector("#edit-org-name").value.trim(),
      type: document.querySelector("#edit-org-type").value,
      published: document.querySelector("#publish-organization").checked,
      address: document.querySelector("#organization-address").value.trim(),
      website: document.querySelector("#organization-website").value.trim(),
      contacts: readContactsFromForm()
    };
    const result = await apiRequest(
      `/api/organizations/${encodeURIComponent(selectedOrganization.slug)}`,
      "PUT",
      body
    );
    await loadOrganizations(result.organization.slug);
    setStatus(body.published ? "Settings saved. Your page is public." : "Settings saved. Your page is private.");
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#publish-organization-button").addEventListener("click", () => {
  document.querySelector("#publish-organization").checked = true;
  organizationForm.requestSubmit();
});

document.querySelector("#unpublish-organization-button").addEventListener("click", () => {
  document.querySelector("#publish-organization").checked = false;
  organizationForm.requestSubmit();
});

document.querySelector("#copy-page-link").addEventListener("click", async () => {
  if (!selectedOrganization) return;
  const link = publicPageUrl(selectedOrganization.slug);
  try {
    await navigator.clipboard.writeText(link);
    setStatus("Public page link copied.");
  } catch {
    setStatus(`Copy not available. Public page link: ${link}`);
  }
});

async function handleAuthState(user) {
  if (user && (workspaceIdToken || workspaceDomain)) return;
  dashboard.hidden = true;
  if (!user) {
    workspaceIdToken = "";
    workspaceDomain = "";
    authPanel.hidden = false;
    organizationForm.hidden = true;
    setStatus("");
    return;
  }
  authPanel.hidden = false;
  organizationForm.hidden = true;
  setStatus("Sign in again with Google or verify your organization email for this session.", "error");
}

async function loadOrganizations(selectedSlug = "") {
  try {
    const result = await apiRequest("/api/organizations/mine");
    organizations = result.organizations;
    const currentSlug = selectedSlug || (organizations.length === 1 ? organizations[0].slug : "");
    selectedOrganization = organizations.find((item) => item.slug === currentSlug);
    showOrganization(selectedOrganization);
    if (organizations.length === 0) {
      setStatus("No pages yet. Create a draft page for your organization.");
    }
  } catch (error) {
    setStatus(error.message);
  }
}

function showOrganization(organization) {
  organizationForm.hidden = !organization;
  if (!organization) return;
  document.querySelector("#edit-org-name").value = organization.name;
  document.querySelector("#edit-org-type").value = organization.type;
  document.querySelector("#edit-org-slug").textContent = organization.slug;
  const publishOption = document.querySelector("#publish-organization");
  publishOption.checked = organization.published;
  document.querySelector("#organization-address").value = organization.address || "";
  document.querySelector("#organization-website").value = organization.website || "";
  for (const key of ["security", "medical", "counselor"]) {
    const contact = organization.contacts?.[key] || {};
    document.querySelector(`#${key}-label`).value = contact.label || "";
    document.querySelector(`#${key}-phone`).value = contact.phone || "";
    document.querySelector(`#${key}-description`).value = contact.description || "";
  }
  document.querySelector("#page-link-preview").textContent =
    `Public page: ${publicPageUrl(organization.slug)}`;
  const qrLink = document.querySelector("#download-qr");
  const qrImage = document.querySelector("#organization-qr");
  if (organization.published) {
    const qrUrl = `/api/organization-qr/${encodeURIComponent(organization.slug)}`;
    qrLink.href = qrUrl;
    qrLink.hidden = false;
    qrImage.src = `${qrUrl}?inline=1`;
    qrImage.hidden = false;
  } else {
    qrLink.hidden = true;
    qrImage.hidden = true;
    qrImage.removeAttribute("src");
  }
}

function readContactsFromForm() {
  const contacts = {};
  for (const key of ["security", "medical", "counselor"]) {
    contacts[key] = {
      label: document.querySelector(`#${key}-label`).value.trim(),
      phone: document.querySelector(`#${key}-phone`).value.trim(),
      description: document.querySelector(`#${key}-description`).value.trim()
    };
  }
  return contacts;
}

function emptyContacts() {
  return {
    security: { label: "", phone: "", description: "" },
    medical: { label: "", phone: "", description: "" },
    counselor: { label: "", phone: "", description: "" }
  };
}

async function apiRequest(url, method = "GET", body) {
  const user = auth?.currentUser;
  if (!user) throw new Error("Sign in to continue.");
  const token = await user.getIdToken(true);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Google-ID-Token": workspaceIdToken,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const responseText = await response.text();
  let result;
  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch {
    if (!response.ok) {
      throw new Error(
        `The server could not complete the request (HTTP ${response.status}). Please try again later.`
      );
    }
    throw new Error("The server returned an invalid response. Please try again later.");
  }
  if (!response.ok) throw new Error(result.error || `The request failed (HTTP ${response.status}).`);
  return result;
}

function publicPageUrl(slug) {
  return `${window.location.origin}/support/${encodeURIComponent(slug)}`;
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

function setStatus(message, kind = "success") {
  const target = dashboard.hidden ? authStatus : status;
  const other = dashboard.hidden ? status : authStatus;
  target.textContent = message;
  authStatus.classList.toggle("is-error", target === authStatus && kind === "error");
  other.textContent = "";
}

function initializePlaceSearch(prefix, onPlaceSelected) {
  if (placeSearches.has(prefix)) return;
  const input = document.getElementById(`${prefix}-search`);
  const button = document.getElementById(`${prefix}-search-button`);
  const results = document.getElementById(`${prefix}-results`);
  if (!input || !button || !results) return;
  let searchSequence = 0;

  async function searchPlaces() {
    const currentSequence = ++searchSequence;
    const query = input.value.trim();
    if (!query) {
      showPlaceMessage(results, input, "Enter a place name to search.");
      return;
    }
    if (!osmPlaceProvider) {
      showPlaceMessage(results, input, "Place search is unavailable. Enter the address manually.");
      return;
    }

    button.disabled = true;
    button.textContent = "Searching…";
    showPlaceMessage(results, input, "Searching places…");
    try {
      const request = nominatimQueue.then(async () => {
        const wait = Math.max(0, 1100 - (Date.now() - lastNominatimRequestAt));
        if (wait) await new Promise((resolve) => window.setTimeout(resolve, wait));
        lastNominatimRequestAt = Date.now();
        return osmPlaceProvider.search({ query });
      });
      nominatimQueue = request.catch(() => {});
      const locations = await request;
      if (currentSequence !== searchSequence) return;
      results.replaceChildren();
      if (!locations.length) {
        showPlaceMessage(results, input, "No locations found. Try a more specific search.");
        return;
      }
      for (const location of locations) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "place-search-option";
        option.setAttribute("role", "option");
        option.textContent = location.label;
        option.addEventListener("click", () => {
          const address = (location.label || "").trim();
          if (!address) return;
          onPlaceSelected({
            name: location.raw?.name || address.split(",")[0],
            address
          });
          results.hidden = true;
          input.setAttribute("aria-expanded", "false");
        });
        results.append(option);
      }
      results.hidden = false;
      input.setAttribute("aria-expanded", "true");
    } catch {
      if (currentSequence === searchSequence) {
        showPlaceMessage(results, input, "Place search failed. You can enter the address manually.");
      }
    } finally {
      if (currentSequence === searchSequence) {
        button.disabled = false;
        button.textContent = "Search";
      }
    }
  }

  button.addEventListener("click", searchPlaces);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchPlaces();
    }
  });
  input.addEventListener("input", () => {
    searchSequence += 1;
    button.disabled = false;
    button.textContent = "Search";
    results.hidden = true;
    input.setAttribute("aria-expanded", "false");
  });
  placeSearches.add(prefix);
}

function showPlaceMessage(results, input, message) {
  const item = document.createElement("p");
  item.className = "place-search-message";
  item.textContent = message;
  results.replaceChildren(item);
  results.hidden = false;
  input.setAttribute("aria-expanded", "true");
}
