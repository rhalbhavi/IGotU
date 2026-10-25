import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const status = document.querySelector("#admin-status");
const authPanel = document.querySelector("#auth-panel");
const dashboard = document.querySelector("#dashboard");
const organizationSelect = document.querySelector("#organization-select");
const organizationForm = document.querySelector("#organization-form");
const createOrganizationForm = document.querySelector("#create-org-form");
let auth;
let organizations = [];
let selectedOrganization;
let slugManuallyEdited = false;
let workspaceIdToken = "";
let workspaceDomain = "";

document.querySelector("#slug-origin").textContent = `${window.location.origin}/`;

if (!isFirebaseConfigured) {
  status.textContent = "Firebase is not configured yet. Add your Firebase web app settings to firebase-config.js.";
  authPanel.hidden = true;
} else {
  auth = getAuth(initializeApp(firebaseConfig));
  status.textContent = "Sign in with your organization’s Google Workspace account.";
  onAuthStateChanged(auth, handleAuthState);
}

document.querySelector("#google-sign-in").addEventListener("click", signInToWorkspace);
document.querySelector("#refresh-google-session").addEventListener("click", signInToWorkspace);

async function signInToWorkspace() {
  if (!auth) return;
  const alreadyVerified = Boolean(workspaceIdToken);
  setStatus("Opening Google sign-in…");
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const credential = await signInWithPopup(auth, provider);
    const googleCredential = GoogleAuthProvider.credentialFromResult(credential);
    if (!googleCredential?.idToken) {
      throw new Error("Google did not return an identity token. Check the Firebase Google provider setup.");
    }
    workspaceIdToken = googleCredential.idToken;
    const result = await apiRequest("/api/auth/workspace", "POST");
    workspaceDomain = result.domain;
    document.querySelector("#workspace-domain").textContent = workspaceDomain;
    dashboard.hidden = false;
    authPanel.hidden = true;
    document.querySelector("#account-email").textContent = credential.user.email || "";
    await loadOrganizations();
    setStatus(`Signed in with the ${workspaceDomain} Google Workspace domain.`);
  } catch (error) {
    if (!alreadyVerified) {
      workspaceIdToken = "";
      workspaceDomain = "";
      await signOut(auth).catch(() => {});
    }
    setStatus(error.message || "Google sign-in failed.");
  }
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
    contacts: emptyContacts()
  };
  try {
    if (!workspaceIdToken || !workspaceDomain) {
      throw new Error("Sign in again with your organization’s Google Workspace account.");
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

organizationSelect.addEventListener("change", () => {
  selectedOrganization = organizations.find(
    (organization) => organization.slug === organizationSelect.value
  );
  showOrganization(selectedOrganization);
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
  if (user && workspaceIdToken) return;
  dashboard.hidden = true;
  if (!user) {
    workspaceIdToken = "";
    workspaceDomain = "";
    authPanel.hidden = false;
    organizationForm.hidden = true;
    setStatus("Sign in with your organization’s Google Workspace account.");
    return;
  }
  authPanel.hidden = false;
  organizationForm.hidden = true;
  setStatus("Select Continue with Google to verify your Workspace domain for this session.");
}

async function loadOrganizations(selectedSlug = organizationSelect.value) {
  try {
    const result = await apiRequest("/api/organizations/mine");
    organizations = result.organizations;
    organizationSelect.replaceChildren(new Option("Choose an organization", ""));
    for (const organization of organizations) {
      const option = new Option(
        `${organization.name} — ${organization.published ? "published" : "draft"}`,
        organization.slug
      );
      organizationSelect.add(option);
    }
    organizationSelect.value = organizations.some((item) => item.slug === selectedSlug)
      ? selectedSlug
      : "";
    selectedOrganization = organizations.find(
      (item) => item.slug === organizationSelect.value
    );
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
  document.querySelector("#workspace-domain").textContent = organization.workspaceDomain || workspaceDomain;
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
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The request could not be completed.");
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

function setStatus(message) {
  status.textContent = message;
}
