import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
  GoogleAuthProvider,
  deleteUser,
  getAuth,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
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
const verifyAccountPanel = document.querySelector("#verify-account-panel");
const verifiedSuccessPanel = document.querySelector("#verified-success-panel");
const verifyEmailDisplay = document.querySelector("#verify-email-display");
const verifyInstructionText = document.querySelector("#verify-instruction-text");
const verifyEmailFallback = document.querySelector("#verify-email-fallback");
const verifyEmailConfirmInput = document.querySelector("#verify-email-confirm-input");
const verifyEmailConfirmButton = document.querySelector("#verify-email-confirm-button");
const resendVerificationButton = document.querySelector("#resend-verification-button");
const changeEmailButton = document.querySelector("#change-email-button");
const verifyStatus = document.querySelector("#verify-status");
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
const osmPlaceProvider = window.GeoSearch
  ? new window.GeoSearch.OpenStreetMapProvider({
      params: { limit: 8, "accept-language": document.documentElement.lang || "en" }
    })
  : null;

if (window.location.hostname === "127.0.0.1") {
  const localUrl = new URL(window.location.href);
  localUrl.hostname = "localhost";
  window.location.replace(localUrl.href);
}

document.querySelector("#slug-origin").textContent = `${window.location.origin}/`;

if (!isFirebaseConfigured) {
  status.textContent = "Admin setup is temporarily unavailable. Please try again later.";
  authPanel.hidden = true;
} else {
  auth = getAuth(initializeApp(firebaseConfig));
  onAuthStateChanged(auth, handleAuthState);
  if (isSignInWithEmailLink(auth, window.location.href)) {
    authPanel.hidden = true;
    dashboard.hidden = true;
    const savedEmail = localStorage.getItem(emailForSignInStorageKey);
    if (savedEmail) {
      showVerifyAccountScreen(savedEmail);
      setVerifyStatus("Verifying your email address…");
      completeEmailLinkSignIn(savedEmail);
    } else {
      showVerifyAccountScreen("");
      verifyEmailFallback.hidden = false;
      verifyInstructionText.textContent = "Please confirm the organization email address you received the link on to complete verification.";
      verifyEmailConfirmInput.focus();
    }
  }
}

document.querySelector("#google-sign-in").addEventListener("click", signInToWorkspace);
document.querySelector("#refresh-google-session").addEventListener("click", signInToWorkspace);
emailSignInButton.addEventListener("click", () => {
  emailSignInForm.hidden = false;
  emailSignInAddress.focus();
});
emailSignInForm.addEventListener("submit", handleEmailSignIn);

resendVerificationButton?.addEventListener("click", async () => {
  const email = localStorage.getItem(emailForSignInStorageKey) || emailSignInAddress.value.trim().toLowerCase();
  if (!email) {
    showAuthScreen();
    return;
  }
  setVerifyStatus("Resending verification email…");
  try {
    await sendSignInLinkToEmail(auth, email, {
      url: `${window.location.origin}${window.location.pathname}`,
      handleCodeInApp: true
    });
    setVerifyStatus("Verification email resent! Please check your inbox and spam folder.");
  } catch (error) {
    setVerifyStatus(error.message || "Failed to resend verification email.", "error");
  }
});

changeEmailButton?.addEventListener("click", () => {
  showAuthScreen();
});

verifyEmailConfirmButton?.addEventListener("click", () => {
  const confirmedEmail = verifyEmailConfirmInput.value.trim().toLowerCase();
  if (!confirmedEmail) {
    setVerifyStatus("Enter your organization email address.", "error");
    return;
  }
  completeEmailLinkSignIn(confirmedEmail);
});

verifyEmailConfirmInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    verifyEmailConfirmButton.click();
  }
});

function setVerifyStatus(message, type = "info") {
  if (!verifyStatus) return;
  verifyStatus.textContent = message || "";
  if (type === "error") {
    verifyStatus.classList.add("is-error");
  } else {
    verifyStatus.classList.remove("is-error");
  }
}

function showVerifyAccountScreen(email) {
  authPanel.hidden = true;
  dashboard.hidden = true;
  if (verifiedSuccessPanel) verifiedSuccessPanel.hidden = true;
  if (verifyAccountPanel) verifyAccountPanel.hidden = false;
  if (verifyEmailFallback) verifyEmailFallback.hidden = true;
  if (verifyEmailDisplay) verifyEmailDisplay.textContent = email || "your address";
  if (verifyInstructionText) {
    verifyInstructionText.innerHTML = `Please check your inbox (and spam or junk folder) and click the <strong>VERIFY EMAIL</strong> button in that email to continue.`;
  }
  setVerifyStatus("");
}

function showAuthScreen() {
  if (verifyAccountPanel) verifyAccountPanel.hidden = true;
  if (verifiedSuccessPanel) verifiedSuccessPanel.hidden = true;
  dashboard.hidden = true;
  authPanel.hidden = false;
  emailSignInForm.hidden = false;
  emailSignInAddress.focus();
}

function parseJwtPayload(token) {
  try {
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) {
      base64 += "=";
    }
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

async function signInToWorkspace() {
  if (!auth) return;
  if (window.location.hostname === "127.0.0.1") {
    const localUrl = new URL(window.location.href);
    localUrl.hostname = "localhost";
    window.location.replace(localUrl.href);
    return;
  }
  emailSignInForm.hidden = true;
  const alreadyVerified = Boolean(workspaceIdToken);
  if (!alreadyVerified) {
    await signOut(auth).catch(() => {});
  }
  setStatus("Opening Google sign-in…");
  let signedInUser = null;
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const credential = await signInWithPopup(auth, provider);
    signedInUser = credential.user;

    const email = credential.user.email?.toLowerCase() || "";
    const googleEmailDomain = email.split("@").pop();
    if (!email || googleEmailDomain === "gmail.com" || googleEmailDomain === "googlemail.com") {
      throw new Error("Use your organization's Google Workspace account. Personal Gmail accounts aren't accepted.");
    }

    const googleCredential = GoogleAuthProvider.credentialFromResult(credential);
    if (!googleCredential?.idToken) {
      throw new Error("Google did not return an identity token. Check the Firebase Google provider setup.");
    }

    const tokenPayload = parseJwtPayload(googleCredential.idToken);
    const hostedDomain = tokenPayload?.hd?.toLowerCase();
    if (
      !hostedDomain ||
      hostedDomain === "gmail.com" ||
      hostedDomain === "googlemail.com" ||
      googleEmailDomain !== hostedDomain
    ) {
      throw new Error("Use your organization's Google Workspace account. Personal Gmail accounts aren't accepted.");
    }

    workspaceIdToken = googleCredential.idToken;
    await connectSignedInUser(credential.user);
    signedInUser = null;
  } catch (error) {
    if (signedInUser) {
      try {
        await deleteUser(signedInUser);
      } catch (deleteError) {
        console.warn("Could not delete unauthorized Firebase user:", deleteError);
      }
    }
    const popupWasClosed = ["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(error.code);
    if (popupWasClosed || !alreadyVerified) {
      workspaceIdToken = "";
      workspaceDomain = "";
      await signOut(auth).catch(() => {});
    }
    const message = error.code === "auth/unauthorized-domain"
      ? (window.location.hostname === "127.0.0.1"
          ? `This site (127.0.0.1) is not authorized in Firebase. Use http://localhost:${window.location.port || "5500"}${window.location.pathname} instead (authorized by default), or add 127.0.0.1 in Firebase Console under Authentication → Settings → Authorized domains.`
          : `This site (${window.location.hostname}) is not authorized for Firebase sign-in. Add this hostname in Firebase Console under Authentication → Settings → Authorized domains, then try again.`)
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
    setStatus("Sending verification email…");
    await sendSignInLinkToEmail(auth, email, {
      url: `${window.location.origin}${window.location.pathname}`,
      handleCodeInApp: true
    });
    setStatus("");
    showVerifyAccountScreen(email);
  } catch (error) {
    if (error.code === "auth/operation-not-allowed") {
      setStatus("Email sign-in is not enabled for this project yet.", "error");
    } else {
      setStatus(error.message || "Could not send the verification email.", "error");
    }
  }
}

async function completeEmailLinkSignIn(email) {
  let signedInUser = null;
  if (verifyAccountPanel && !verifyAccountPanel.hidden) {
    setVerifyStatus("Verifying your email address…");
  } else {
    setStatus("Verifying your email address…");
  }

  try {
    const credential = await signInWithEmailLink(auth, email, window.location.href);
    signedInUser = credential.user;
    localStorage.removeItem(emailForSignInStorageKey);
    window.history.replaceState({}, document.title, window.location.pathname);
    await connectSignedInUser(credential.user, { deferDashboard: true });
    signedInUser = null;

    // Show verification success screen with large green check mark in light green circle
    authPanel.hidden = true;
    if (verifyAccountPanel) verifyAccountPanel.hidden = true;
    dashboard.hidden = true;
    if (verifiedSuccessPanel) verifiedSuccessPanel.hidden = false;

    // After 2 seconds navigate to dashboard screen
    setTimeout(() => {
      if (verifiedSuccessPanel) verifiedSuccessPanel.hidden = true;
      dashboard.hidden = false;
    }, 2000);
  } catch (error) {
    if (signedInUser) {
      try {
        await deleteUser(signedInUser);
      } catch (deleteError) {
        console.warn("Could not delete unverified email user:", deleteError);
      }
    }
    await signOut(auth).catch(() => {});
    showAuthScreen();
    setStatus(error.message || "That sign-in link is invalid or expired. Request a new one.", "error");
  }
}

async function connectSignedInUser(user, options = {}) {
  const { deferDashboard = false } = options;
  const result = await apiRequest("/api/auth/workspace", "POST");
  workspaceDomain = result.domain;
  if (!deferDashboard) {
    dashboard.hidden = false;
    authPanel.hidden = true;
    if (verifyAccountPanel) verifyAccountPanel.hidden = true;
    if (verifiedSuccessPanel) verifiedSuccessPanel.hidden = true;
  }
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
  const isGoogle = user.providerData.some((provider) => provider.providerId === "google.com") || Boolean(workspaceIdToken);
  setStatus(isGoogle
    ? `Signed in with the ${workspaceDomain} Google Workspace domain.`
    : "Signed in with your organization's verified email.");
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
    if (verifyAccountPanel) verifyAccountPanel.hidden = true;
    if (verifiedSuccessPanel) verifiedSuccessPanel.hidden = true;
    organizationForm.hidden = true;
    setStatus("");
    return;
  }

  const email = user.email?.toLowerCase() || "";
  const domain = email.split("@").pop();
  if (!email || domain === "gmail.com" || domain === "googlemail.com") {
    try {
      await deleteUser(user);
    } catch (e) {
      console.warn("Could not delete invalid user on auth state change:", e);
    }
    workspaceIdToken = "";
    workspaceDomain = "";
    await signOut(auth).catch(() => {});
    authPanel.hidden = false;
    if (verifyAccountPanel) verifyAccountPanel.hidden = true;
    if (verifiedSuccessPanel) verifiedSuccessPanel.hidden = true;
    organizationForm.hidden = true;
    setStatus("Use your organization's Google Workspace account. Personal Gmail accounts aren't accepted.", "error");
    return;
  }

  authPanel.hidden = false;
  if (verifyAccountPanel) verifyAccountPanel.hidden = true;
  if (verifiedSuccessPanel) verifiedSuccessPanel.hidden = true;
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
