const pathMatch = window.location.pathname.match(/^\/support\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
const organizationSlug =
  pathMatch?.[1] || new URLSearchParams(window.location.search).get("org");
const organizationSection = document.querySelector("#organization-section");
const organizationName = document.querySelector("#organization-name");
const organizationStatus = document.querySelector("#organization-status");

if (organizationSlug && organizationSection && organizationName && organizationStatus) {
  loadOrganizationPage(organizationSlug);
}

async function loadOrganizationPage(slug) {
  try {
    const response = await fetch(`/api/organizations/${encodeURIComponent(slug)}`);
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "This support page could not be loaded.");
    }
    renderOrganization(result.organization);
  } catch (error) {
    organizationStatus.textContent = error.message;
    organizationStatus.hidden = false;
  }
}

function renderOrganization(organization) {
  const supportHeading = document.querySelector("#local-title");
  const supportDescription = document.querySelector("#organization-support-description");
  const typeLabels = {
    residential: ["RESIDENTIAL SUPPORT", "Contact your community security or emergency services."],
    campus: ["CAMPUS SUPPORT", "Contact your campus security or support services."],
    educational: ["EDUCATIONAL SUPPORT", "Contact your institution's support services."],
    public: ["LOCAL SUPPORT", "Contact the local support services listed here."]
  };
  const [heading, description] = typeLabels[organization.type] || typeLabels.public;

  organizationName.textContent = organization.name;
  organizationName.hidden = false;
  supportHeading.textContent = heading;
  supportDescription.textContent = description;
  renderContact("security", organization.contacts.security);
  renderContact("medical", organization.contacts.medical);
  renderContact("counselor", organization.contacts.counselor);
  organizationSection.hidden = false;
  document.title = `${organization.name} — IGotU`;
}

function renderContact(key, contact) {
  const card = document.querySelector(`#${key}-contact`);
  if (!card || !contact?.phone) return;
  const phone = contact.phone.replace(/[^\d+]/g, "");
  card.href = `tel:${phone}`;
  document.querySelector(`#${key}-name`).textContent = contact.label;
  document.querySelector(`#${key}-description`).textContent =
    contact.description || `Call ${contact.label}.`;
  card.hidden = false;
}
