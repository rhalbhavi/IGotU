import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
  GoogleAuthProvider,
  applyActionCode,
  deleteUser,
  getAuth,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendEmailVerification,
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
let workspaceIdToken = sessionStorage.getItem("igotu-workspace-id-token") || localStorage.getItem("igotu-workspace-id-token") || "";
let workspaceDomain = "";
const placeSearches = new Set();
let nominatimQueue = Promise.resolve();
let lastNominatimRequestAt = 0;
const emailForSignInStorageKey = "igotu-email-for-sign-in";
const pendingVerificationStorageKey = "igotu-pending-verification";
let verificationPollTimer = null;

function getVerificationActionUrl() {
  const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const baseUrl = isLocal ? `${window.location.origin}/setup.html` : "https://igotu-web.vercel.app/setup.html";
  return `${baseUrl}?verified=true`;
}

function clearWorkspaceToken() {
  workspaceIdToken = "";
  sessionStorage.removeItem("igotu-workspace-id-token");
  localStorage.removeItem("igotu-workspace-id-token");
}

function getPendingVerification() {
  try {
    const raw = localStorage.getItem(pendingVerificationStorageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setPendingVerification(email, provider = "google", uid = "") {
  try {
    localStorage.setItem(
      pendingVerificationStorageKey,
      JSON.stringify({
        email: (email || "").toLowerCase().trim(),
        provider,
        uid: uid || "",
        sentAt: Date.now()
      })
    );
  } catch (e) {
    console.warn("Could not save pending verification:", e);
  }
}

function clearPendingVerification() {
  try {
    localStorage.removeItem(pendingVerificationStorageKey);
  } catch (e) {
    console.warn("Could not clear pending verification:", e);
  }
}

async function isUserVerified(user) {
  if (!user) return false;

  // 1. In-session verification flag (set after successful verification in the current active session)
  if (sessionStorage.getItem(`igotu_session_verified_${user.uid}`) === "true") {
    return true;
  }

  // 2. Verified flag for this UID in localStorage
  if (localStorage.getItem(`igotu_verified_uid_${user.uid}`) === "true") {
    sessionStorage.setItem(`igotu_session_verified_${user.uid}`, "true");
    return true;
  }

  // 3. Force-refresh ID token and check Firebase custom claim (authoritative source)
  try {
    const tokenResult = await user.getIdTokenResult(true);
    if (tokenResult?.claims?.igotu_verified === true) {
      sessionStorage.setItem(`igotu_session_verified_${user.uid}`, "true");
      localStorage.setItem(`igotu_verified_uid_${user.uid}`, "true");
      return true;
    }
  } catch (e) {
    console.warn("getIdTokenResult check error:", e);
  }

  // 4. Ask server status endpoint — authoritative check
  try {
    const res = await apiRequest("/api/auth/status", "GET");
    if (res?.verified === true) {
      sessionStorage.setItem(`igotu_session_verified_${user.uid}`, "true");
      localStorage.setItem(`igotu_verified_uid_${user.uid}`, "true");
      return true;
    }
  } catch (e) {
    console.warn("api/auth/status check error:", e);
  }

  return false;
}

async function markUserVerified(user) {
  if (!user) return;
  sessionStorage.setItem(`igotu_session_verified_${user.uid}`, "true");
  localStorage.setItem(`igotu_verified_uid_${user.uid}`, "true");
  sessionStorage.removeItem(`igotu_awaiting_verification_${user.uid}`);
  try {
    await apiRequest("/api/auth/confirm-verification", "POST");
  } catch (e) {
    console.warn("confirm-verification notice:", e);
  }
}

let isTransitioningToSuccess = false;
let dashboardReady = false; // set true once connectSignedInUser succeeds

function showVerifiedSuccessScreen() {
  authPanel.hidden = true;
  if (verifyAccountPanel) verifyAccountPanel.hidden = true;
  dashboard.hidden = true;
  if (verifiedSuccessPanel) verifiedSuccessPanel.hidden = false;
}

async function triggerVerificationSuccessTransition(user) {
  if (isTransitioningToSuccess) return;
  isTransitioningToSuccess = true;

  stopVerificationPolling();
  clearPendingVerification();
  showVerifiedSuccessScreen();

  const currentUser = user || auth?.currentUser;

  if (currentUser) {
    // Mark verified in all local caches immediately so handleAuthState never re-routes
    sessionStorage.setItem(`igotu_session_verified_${currentUser.uid}`, "true");
    localStorage.setItem(`igotu_verified_uid_${currentUser.uid}`, "true");
    sessionStorage.removeItem(`igotu_awaiting_verification_${currentUser.uid}`);
    clearPendingVerification();

    // Fire-and-forget server confirmation (non-blocking)
    apiRequest("/api/auth/confirm-verification", "POST").catch((e) =>
      console.warn("confirm-verification notice:", e)
    );

    // Pre-load dashboard data while success screen is showing
    try {
      await connectSignedInUser(currentUser, { deferDashboard: true });
      dashboardReady = true;
    } catch (e) {
      console.warn("connectSignedInUser error in transition:", e);
    }
  }

  // After 3 seconds reveal dashboard on THIS same tab/window
  setTimeout(() => {
    if (verifiedSuccessPanel) verifiedSuccessPanel.hidden = true;
    const activeUser = auth?.currentUser || currentUser;
    if (activeUser) {
      dashboard.hidden = false;
      authPanel.hidden = true;
      if (verifyAccountPanel) verifyAccountPanel.hidden = true;
      if (organizations.length > 0) {
        showOrganization(selectedOrganization || organizations[0]);
      }
    } else {
      // Signed out in the interim — just show auth
      showAuthScreen();
      setStatus("Email verified! Please sign in to access your dashboard.");
    }
    isTransitioningToSuccess = false;
  }, 3000);
}

async function checkVerificationStatus() {
  // Don't run if already on the dashboard or mid-transition
  if (isTransitioningToSuccess || !dashboard.hidden) return;
  if (verifyAccountPanel && verifyAccountPanel.hidden) return;

  const justVerified = localStorage.getItem("igotu_just_verified");
  if (justVerified && Date.now() - Number(justVerified) < 30_000) {
    await triggerVerificationSuccessTransition(auth?.currentUser);
    return;
  }

  if (auth?.currentUser) {
    try {
      await auth.currentUser.reload();
      const verified = await isUserVerified(auth.currentUser);
      if (verified) {
        await triggerVerificationSuccessTransition(auth.currentUser);
        return;
      }
    } catch (e) {
      console.warn("checkVerificationStatus notice:", e);
    }
  }
}

function startVerificationPolling() {
  stopVerificationPolling();
  verificationPollTimer = setInterval(checkVerificationStatus, 3000);
}

function stopVerificationPolling() {
  if (verificationPollTimer) {
    clearInterval(verificationPollTimer);
    verificationPollTimer = null;
  }
}

window.addEventListener("focus", checkVerificationStatus);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    checkVerificationStatus();
  }
});
window.addEventListener("storage", (event) => {
  if (event.key === "igotu_just_verified" || event.key?.startsWith("igotu_verified_uid_")) {
    if (!isTransitioningToSuccess && (dashboard.hidden || (verifyAccountPanel && !verifyAccountPanel.hidden))) {
      triggerVerificationSuccessTransition(auth?.currentUser);
    }
  }
});

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

  const pendingOnLoad = getPendingVerification();
  const urlParams = new URLSearchParams(window.location.search);
  const authMode = urlParams.get("mode");
  const actionCode = urlParams.get("oobCode");
  const isActionRedirect = (authMode === "verifyEmail" && actionCode) || isSignInWithEmailLink(auth, window.location.href);

  // Show verify screen early if we have a pending email and no action redirect coming
  if (!isActionRedirect && pendingOnLoad?.email) {
    showVerifyAccountScreen(pendingOnLoad.email);
    startVerificationPolling();
  }

  onAuthStateChanged(auth, handleAuthState);

  if (authMode === "verifyEmail" && actionCode) {
    handleEmailVerificationRedirect(actionCode);
  } else if (isSignInWithEmailLink(auth, window.location.href)) {
    handleEmailLinkSignInRedirect();
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
  const pending = getPendingVerification();
  const email = pending?.email || localStorage.getItem(emailForSignInStorageKey) || auth?.currentUser?.email || emailSignInAddress.value.trim().toLowerCase();
  setVerifyStatus("Resending verification email…");
  try {
    let resent = false;
    if (auth?.currentUser) {
      try {
        await sendEmailVerification(auth.currentUser, {
          url: getVerificationActionUrl()
        });
        resent = true;
      } catch (err) {
        console.warn("sendEmailVerification resend notice:", err);
      }
    }
    if (!resent && email) {
      await sendSignInLinkToEmail(auth, email, {
        url: getVerificationActionUrl(),
        handleCodeInApp: true
      });
      resent = true;
    }
    if (!resent) {
      showAuthScreen();
      return;
    }
    if (email) setPendingVerification(email, "google", auth?.currentUser?.uid);
    setVerifyStatus("Verification email resent! Please check your inbox and spam folder.");
  } catch (error) {
    setVerifyStatus(error.message || "Failed to resend verification email.", "error");
  }
});

changeEmailButton?.addEventListener("click", async () => {
  stopVerificationPolling();
  clearPendingVerification();
  clearWorkspaceToken();
  workspaceDomain = "";
  if (auth) {
    await signOut(auth).catch(() => {});
  }
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

async function handleEmailVerificationRedirect(actionCode) {
  showVerifiedSuccessScreen();
  isTransitioningToSuccess = true;

  try {
    await applyActionCode(auth, actionCode);

    // Ensure Firebase user authentication state is resolved if opened in a fresh tab
    let user = auth.currentUser;
    if (!user) {
      user = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 2500);
        const unsubscribe = onAuthStateChanged(auth, (u) => {
          if (u) {
            clearTimeout(timer);
            unsubscribe();
            resolve(u);
          }
        });
      });
    }

    window.history.replaceState({}, document.title, window.location.pathname);
    isTransitioningToSuccess = false;
    await triggerVerificationSuccessTransition(user);
  } catch (error) {
    isTransitioningToSuccess = false;
    showAuthScreen();
    setStatus(error.message || "Email verification failed or link has expired.", "error");
  }
}

async function handleEmailLinkSignInRedirect() {
  const savedEmail = localStorage.getItem(emailForSignInStorageKey);
  if (savedEmail) {
    showVerifiedSuccessScreen();
    isTransitioningToSuccess = true;
    completeEmailLinkSignIn(savedEmail);
  } else {
    showVerifyAccountScreen("");
    if (verifyEmailFallback) verifyEmailFallback.hidden = false;
    if (verifyInstructionText) {
      verifyInstructionText.textContent = "Please confirm the organization email address you received the link on to complete verification.";
    }
    verifyEmailConfirmInput?.focus();
  }
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
  setStatus("Opening Google sign-in…");
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const credential = await signInWithPopup(auth, provider);

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
    sessionStorage.setItem("igotu-workspace-id-token", workspaceIdToken);
    localStorage.setItem("igotu-workspace-id-token", workspaceIdToken);
    localStorage.setItem(emailForSignInStorageKey, email);

    // Refresh user state
    await credential.user.reload().catch(() => {});

    // Check if the user is genuinely verified in IGotU (via custom claims or server)
    let genuinelyVerified = false;
    try {
      const tokenResult = await credential.user.getIdTokenResult(true);
      if (tokenResult?.claims?.igotu_verified === true) genuinelyVerified = true;
    } catch {}
    if (!genuinelyVerified) {
      try {
        const res = await apiRequest("/api/auth/status", "GET");
        if (res?.verified === true) genuinelyVerified = true;
      } catch {}
    }

    if (!genuinelyVerified) {
      localStorage.removeItem(`igotu_verified_uid_${credential.user.uid}`);
      sessionStorage.removeItem(`igotu_session_verified_${credential.user.uid}`);
    } else {
      localStorage.setItem(`igotu_verified_uid_${credential.user.uid}`, "true");
      sessionStorage.setItem(`igotu_session_verified_${credential.user.uid}`, "true");
    }

    if (genuinelyVerified) {
      clearPendingVerification();
      stopVerificationPolling();
      await connectSignedInUser(credential.user);
      return;
    }

    // User is NOT verified in IGotU - DO NOT GO TO DASHBOARD!
    // Send verification email to their organization address.
    setStatus("Sending verification email…");
    let emailDispatched = false;
    try {
      await sendEmailVerification(credential.user, {
        url: getVerificationActionUrl()
      });
      emailDispatched = true;
    } catch (emailErr) {
      console.warn("sendEmailVerification notice:", emailErr);
    }

    // If sendEmailVerification failed or rejected (common for pre-verified Google accounts),
    // fallback to sending a sign-in / verification link to their email so they get the email.
    if (!emailDispatched) {
      try {
        await sendSignInLinkToEmail(auth, email, {
          url: getVerificationActionUrl(),
          handleCodeInApp: true
        });
        emailDispatched = true;
      } catch (linkErr) {
        console.error("sendSignInLinkToEmail error:", linkErr);
        throw new Error(linkErr.message || "Failed to send verification email. Please try again.");
      }
    }

    setStatus("");
    setPendingVerification(email, "google", credential.user.uid);
    sessionStorage.setItem(`igotu_awaiting_verification_${credential.user.uid}`, "true");
    showVerifyAccountScreen(email);
    startVerificationPolling();
  } catch (error) {
    const popupWasClosed = ["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(error.code);
    clearWorkspaceToken();
    workspaceDomain = "";
    await signOut(auth).catch(() => {});
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
    setPendingVerification(email, "email");
    setStatus("Sending verification email…");
    await sendSignInLinkToEmail(auth, email, {
      url: getVerificationActionUrl(),
      handleCodeInApp: true
    });
    setStatus("");
    showVerifyAccountScreen(email);
    startVerificationPolling();
  } catch (error) {
    if (error.code === "auth/operation-not-allowed") {
      setStatus("Email sign-in is not enabled for this project yet.", "error");
    } else {
      setStatus(error.message || "Could not send the verification email.", "error");
    }
  }
}

async function completeEmailLinkSignIn(email) {
  showVerifiedSuccessScreen();
  isTransitioningToSuccess = true;

  try {
    const credential = await signInWithEmailLink(auth, email, window.location.href);
    localStorage.removeItem(emailForSignInStorageKey);
    window.history.replaceState({}, document.title, window.location.pathname);

    isTransitioningToSuccess = false;
    await triggerVerificationSuccessTransition(credential.user);
  } catch (error) {
    isTransitioningToSuccess = false;
    await signOut(auth).catch(() => {});
    showAuthScreen();
    setStatus(error.message || "That sign-in link is invalid or expired. Request a new one.", "error");
  }
}

async function connectSignedInUser(user, options = {}) {
  const { deferDashboard = false } = options;
  stopVerificationPolling();
  clearPendingVerification();
  try {
    const result = await apiRequest("/api/auth/workspace", "POST");
    workspaceDomain = result.domain;
  } catch (err) {
    console.warn("api/auth/workspace notice:", err);
    workspaceDomain = user.email ? user.email.split("@")[1] : "";
  }
  dashboardReady = true;
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

document.querySelector("#sign-out").addEventListener("click", () => {
  stopVerificationPolling();
  clearPendingVerification();
  clearWorkspaceToken();
  workspaceDomain = "";
  dashboardReady = false;
  signOut(auth);
});

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
    setStatus(error.message, "error");
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

document.querySelector("#delete-organization-button")?.addEventListener("click", async () => {
  if (!selectedOrganization) return;
  const orgName = selectedOrganization.name;
  const orgSlug = selectedOrganization.slug;
  const confirmed = window.confirm(
    `Are you sure you want to permanently delete "${orgName}" (${orgSlug}) and all its details? This cannot be undone.`
  );
  if (!confirmed) return;

  try {
    setStatus("Deleting organization page…");
    await apiRequest(`/api/organizations/${encodeURIComponent(orgSlug)}`, "DELETE");
    selectedOrganization = null;
    await loadOrganizations();
    setStatus(`"${orgName}" and all its details have been removed.`);
  } catch (error) {
    setStatus(error.message, "error");
  }
});

async function handleAuthState(user) {
  // If we're mid-transition or the dashboard is already showing, don't interfere
  if (isTransitioningToSuccess) return;
  if (dashboardReady && !dashboard.hidden) return;

  const pending = getPendingVerification();
  const urlParams = new URLSearchParams(window.location.search);

  if (user) {
    const email = user.email?.toLowerCase() || "";
    const domain = email.split("@").pop();
    if (!email || domain === "gmail.com" || domain === "googlemail.com") {
      stopVerificationPolling();
      clearPendingVerification();
      try {
        await deleteUser(user);
      } catch (e) {
        console.warn("Could not delete invalid user on auth state change:", e);
      }
      clearWorkspaceToken();
      workspaceDomain = "";
      await signOut(auth).catch(() => {});
      authPanel.hidden = false;
      if (verifyAccountPanel) verifyAccountPanel.hidden = true;
      if (verifiedSuccessPanel) verifiedSuccessPanel.hidden = true;
      organizationForm.hidden = true;
      setStatus("Use your organization's Google Workspace account. Personal Gmail accounts aren't accepted.", "error");
      return;
    }

    try {
      await user.reload();
    } catch (e) {
      console.warn("Could not reload user in auth state change:", e);
    }

    // If the success panel is currently visible, we're in transition — don't re-route
    if (verifiedSuccessPanel && !verifiedSuccessPanel.hidden) return;

    // Check session-level verified flag first (fastest, no network)
    const sessionVerified = sessionStorage.getItem(`igotu_session_verified_${user.uid}`) === "true";
    const localVerified = localStorage.getItem(`igotu_verified_uid_${user.uid}`) === "true";

    if (sessionVerified || localVerified) {
      // Already verified — go straight to dashboard
      stopVerificationPolling();
      clearPendingVerification();
      if (verifyAccountPanel) verifyAccountPanel.hidden = true;
      if (verifiedSuccessPanel) verifiedSuccessPanel.hidden = true;
      try {
        await connectSignedInUser(user);
        return;
      } catch (e) {
        console.warn("connectSignedInUser error (cached verified):", e);
        // Don't fall through to unverified — stay where we are
        return;
      }
    }

    const verified = await isUserVerified(user);

    if (verified) {
      const wasPending = Boolean(
        pending?.email ||
        sessionStorage.getItem(`igotu_awaiting_verification_${user.uid}`) ||
        (verifyAccountPanel && !verifyAccountPanel.hidden)
      );
      if (wasPending) {
        await triggerVerificationSuccessTransition(user);
        return;
      }

      stopVerificationPolling();
      clearPendingVerification();
      if (verifyAccountPanel) verifyAccountPanel.hidden = true;
      try {
        await connectSignedInUser(user);
        return;
      } catch (e) {
        console.warn("connectSignedInUser error in auth state:", e);
      }
    } else {
      const displayEmail = email || pending?.email || user.email || "";
      dashboard.hidden = true;
      authPanel.hidden = true;
      if (verifiedSuccessPanel) verifiedSuccessPanel.hidden = true;
      if (displayEmail) {
        setPendingVerification(displayEmail, user.providerData?.[0]?.providerId === "google.com" ? "google" : "email", user.uid);
        sessionStorage.setItem(`igotu_awaiting_verification_${user.uid}`, "true");
        showVerifyAccountScreen(displayEmail);
        startVerificationPolling();
        return;
      }
    }
  } else {
    // No user signed in
    if (verifiedSuccessPanel && !verifiedSuccessPanel.hidden) {
      // Success screen is showing — let the timer handle it, don't interfere
      return;
    }

    if (pending?.email) {
      showVerifyAccountScreen(pending.email);
      startVerificationPolling();
      return;
    }

    clearWorkspaceToken();
    workspaceDomain = "";
    authPanel.hidden = false;
    if (verifyAccountPanel) verifyAccountPanel.hidden = true;
    if (verifiedSuccessPanel) verifiedSuccessPanel.hidden = true;
    organizationForm.hidden = true;
    dashboard.hidden = true;
    setStatus("");
    return;
  }
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
  updateCounselorLegend(organization.type);
  const publishOption = document.querySelector("#publish-organization");
  publishOption.checked = organization.published;
  document.querySelector("#organization-address").value = organization.address || "";
  document.querySelector("#organization-website").value = organization.website || "";
  for (const key of ["security", "medical", "counselor"]) {
    const contact = organization.contacts?.[key] || {};
    document.querySelector(`#${key}-label`).value = contact.label || "";
    document.querySelector(`#${key}-description`).value = contact.description || "";
    const countrySelect = document.querySelector(`#${key}-country`);
    const phoneInput = document.querySelector(`#${key}-phone`);
    if (countrySelect && phoneInput) {
      setPhoneAndCountry(countrySelect, phoneInput, contact.phone || "");
    }
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

const COUNTRY_CONFIGS = {
  "+91": { name: "India (+91)", code: "+91", min: 10, max: 10, placeholder: "98765 43210" },
  "+1": { name: "USA (+1)", code: "+1", min: 10, max: 10, placeholder: "202 555 0123" },
  "+1-CA": { name: "Canada (+1)", code: "+1", min: 10, max: 10, placeholder: "416 555 0123" },
  "+44": { name: "UK (+44)", code: "+44", min: 10, max: 11, placeholder: "7911 123456" },
  "+61": { name: "Australia (+61)", code: "+61", min: 9, max: 9, placeholder: "412 345 678" },
  "+49": { name: "Germany (+49)", code: "+49", min: 10, max: 11, placeholder: "151 23456789" },
  "other": { name: "Other", code: "", min: 7, max: 15, placeholder: "Phone number" }
};

function formatAndValidatePhone(rawNumber, countryKey, contactKey) {
  const contactNames = {
    security: "Security contact",
    medical: "Medical services",
    counselor: "Counsellor"
  };
  const roleName = contactNames[contactKey] || "Contact";
  const trimmed = (rawNumber || "").trim();
  if (!trimmed) return "";

  if (!/^\+?[0-9 ()-]+$/.test(trimmed)) {
    throw new Error(`${roleName} phone number contains invalid characters. Use digits, spaces, and hyphens.`);
  }

  let digits = trimmed.replace(/\D/g, "");

  if (countryKey === "+91") {
    if (trimmed.startsWith("+91") || (digits.startsWith("91") && digits.length === 12)) {
      digits = digits.slice(2);
    }
    if (digits.length !== 10) {
      throw new Error(`${roleName} phone number must be 10 digits for India (+91).`);
    }
    return `+91 ${digits}`;
  }

  if (countryKey === "+1") {
    if (trimmed.startsWith("+1") || (digits.startsWith("1") && digits.length === 11)) {
      digits = digits.slice(1);
    }
    if (digits.length !== 10) {
      throw new Error(`${roleName} phone number must be 10 digits for USA (+1).`);
    }
    return `+1 ${digits}`;
  }

  if (countryKey === "+1-CA") {
    if (trimmed.startsWith("+1") || (digits.startsWith("1") && digits.length === 11)) {
      digits = digits.slice(1);
    }
    if (digits.length !== 10) {
      throw new Error(`${roleName} phone number must be 10 digits for Canada (+1).`);
    }
    return `+1 ${digits}`;
  }

  if (countryKey === "+44") {
    if (trimmed.startsWith("+44") || (digits.startsWith("44") && (digits.length === 12 || digits.length === 13))) {
      digits = digits.slice(2);
    }
    if (digits.length !== 10 && digits.length !== 11) {
      throw new Error(`${roleName} phone number must be 10 or 11 digits for UK (+44).`);
    }
    return `+44 ${digits}`;
  }

  if (countryKey === "+61") {
    if (trimmed.startsWith("+61") || (digits.startsWith("61") && digits.length === 11)) {
      digits = digits.slice(2);
    }
    if (digits.length !== 9) {
      throw new Error(`${roleName} phone number must be 9 digits for Australia (+61).`);
    }
    return `+61 ${digits}`;
  }

  if (countryKey === "+49") {
    if (trimmed.startsWith("+49") || (digits.startsWith("49") && (digits.length === 12 || digits.length === 13))) {
      digits = digits.slice(2);
    }
    if (digits.length !== 10 && digits.length !== 11) {
      throw new Error(`${roleName} phone number must be 10 or 11 digits for Germany (+49).`);
    }
    return `+49 ${digits}`;
  }

  if (digits.length < 7 || digits.length > 15) {
    throw new Error(`${roleName} phone number must be between 7 and 15 digits.`);
  }
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

function setPhoneAndCountry(countrySelect, phoneInput, rawPhone) {
  const trimmed = (rawPhone || "").trim();
  if (!trimmed) {
    countrySelect.value = "+91";
    phoneInput.value = "";
    phoneInput.placeholder = COUNTRY_CONFIGS["+91"].placeholder;
    return;
  }
  const prefixes = [
    { code: "+91", prefix: "+91" },
    { code: "+44", prefix: "+44" },
    { code: "+61", prefix: "+61" },
    { code: "+49", prefix: "+49" },
    { code: "+1", prefix: "+1" }
  ];
  const match = prefixes.find((p) => trimmed.startsWith(p.prefix));
  if (match) {
    countrySelect.value = match.code;
    phoneInput.value = trimmed.slice(match.prefix.length).trim();
    phoneInput.placeholder = (COUNTRY_CONFIGS[match.code] || COUNTRY_CONFIGS["other"]).placeholder;
  } else {
    countrySelect.value = "other";
    phoneInput.value = trimmed;
    phoneInput.placeholder = COUNTRY_CONFIGS["other"].placeholder;
  }
}

function readContactsFromForm() {
  const contacts = {};
  for (const key of ["security", "medical", "counselor"]) {
    const label = document.querySelector(`#${key}-label`).value.trim();
    const description = document.querySelector(`#${key}-description`).value.trim();
    const countrySelect = document.querySelector(`#${key}-country`);
    const phoneInput = document.querySelector(`#${key}-phone`);
    const country = countrySelect ? countrySelect.value : "+91";
    const rawNumber = phoneInput ? phoneInput.value.trim() : "";
    const phone = formatAndValidatePhone(rawNumber, country, key);

    contacts[key] = {
      label,
      phone,
      description
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

function updateCounselorLegend(orgType) {
  const legend = document.querySelector("#counselor-legend");
  if (!legend) return;
  legend.textContent = orgType === "residential"
    ? "Counsellor support"
    : "Counsellor or student support";
}

// Update counselor legend when org type dropdown changes
document.querySelector("#edit-org-type")?.addEventListener("change", (e) => {
  updateCounselorLegend(e.target.value);
});

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

function initializePhoneInputs() {
  for (const key of ["security", "medical", "counselor"]) {
    const countrySelect = document.querySelector(`#${key}-country`);
    const phoneInput = document.querySelector(`#${key}-phone`);
    if (!countrySelect || !phoneInput) continue;

    countrySelect.addEventListener("change", () => {
      const config = COUNTRY_CONFIGS[countrySelect.value] || COUNTRY_CONFIGS["other"];
      phoneInput.placeholder = config.placeholder;
    });

    phoneInput.addEventListener("input", () => {
      const val = phoneInput.value.trim();
      if (val.startsWith("+")) {
        for (const prefix of ["+91", "+44", "+61", "+49"]) {
          if (val.startsWith(prefix)) {
            countrySelect.value = prefix;
            phoneInput.value = val.slice(prefix.length).trim();
            phoneInput.placeholder = (COUNTRY_CONFIGS[prefix] || COUNTRY_CONFIGS["other"]).placeholder;
            return;
          }
        }
        if (val.startsWith("+1")) {
          countrySelect.value = "+1";
          phoneInput.value = val.slice(2).trim();
          phoneInput.placeholder = COUNTRY_CONFIGS["+1"].placeholder;
        }
      }
    });
  }
}

initializePhoneInputs();
