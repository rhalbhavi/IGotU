
/*
  IGotU campus sample

  Before deployment:
  1. Replace campus security and counselling numbers in the HTML.
  2. Verify all service numbers, hours, privacy notices, and response procedures.
  3. Test call/SMS links on both iOS and Android.
*/

const trustedDialog = document.querySelector("#trusted-dialog");
const infoDialog = document.querySelector("#info-dialog");
const trustedNumber = document.querySelector("#trusted-number");
const trustedStatus = document.querySelector("#trusted-status");
const contactStatus = document.querySelector("#contact-status");
const contactSearch = document.querySelector("#contact-search");
const contactResults = document.querySelector("#contact-results");
const messageAppDialog = document.querySelector("#message-app-dialog");
const themeToggle = document.querySelector("#theme-toggle");
const themeIcon = document.querySelector("#theme-icon");
let selectedLocation = null;

const suggestedMessage =
  "Hey, I'm having a difficult time right . Are you available to call or meet me right now?";

const isPhoneDevice =
  navigator.userAgentData?.mobile ??
  /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(navigator.userAgent);
if (!isPhoneDevice) {
  document.querySelector("#vandrevala-whatsapp")?.setAttribute("target", "_blank");
  document.querySelector("#vandrevala-whatsapp")?.setAttribute("rel", "noopener noreferrer");
}

document.querySelectorAll("dialog.modal").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

themeToggle?.addEventListener("click", () => {
  if (!themeIcon) return;
  const isDark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.setAttribute(
    "aria-label",
    `Switch to ${isDark ? "light" : "dark"} mode`
  );
  themeIcon.textContent = isDark ? "light_mode" : "dark_mode";
});

// Open the trusted contact dialog
document.querySelector("#trusted-button")?.addEventListener("click", () => {
  if (!trustedDialog || !trustedStatus) return;
  trustedStatus.textContent = "";
  trustedDialog.showModal();
  requestCurrentLocation();
});

document.querySelector("#pick-contacts")?.addEventListener("click", async () => {
  if (!contactStatus || !contactSearch || !contactResults) return;
  if (!navigator.contacts?.select) {
    contactStatus.textContent =
      "Contact selection isn't supported in this browser. Enter the number manually instead.";
    return;
  }

  try {
    const contacts = await navigator.contacts.select(["name", "tel"], {
      multiple: true
    });
    renderSelectedContacts(contacts);
    contactSearch.disabled = contacts.length === 0;
    contactSearch.value = "";
    contactStatus.textContent = contacts.length
      ? `${contacts.length} selected contact${contacts.length === 1 ? "" : "s"}. Search the list or choose one to use their number.`
      : "No contacts selected. You can enter a number manually.";
  } catch (error) {
    if (error.name === "AbortError") {
      contactStatus.textContent = "Contact selection was cancelled.";
    } else {
      contactStatus.textContent =
        "Couldn't open the contact picker. Enter the number manually instead.";
    }
  }
});

contactSearch?.addEventListener("input", () => {
  if (!contactResults) return;
  const query = contactSearch.value.trim().toLocaleLowerCase();
  for (const item of contactResults.querySelectorAll("li")) {
    item.hidden = !item.dataset.searchText.includes(query);
  }
});

document.querySelector("#sms-trusted")?.addEventListener("click", () => {
  if (!trustedNumber || !trustedStatus) return;
  const number = cleanPhoneNumber(trustedNumber.value);

  if (!number) {
    trustedStatus.textContent =
      "Enter or select the phone number of the person you want to text.";
    trustedNumber.focus();
    return;
  }

  if (messageAppDialog?.showModal) {
    trustedDialog?.close();
    messageAppDialog.showModal();
  } else {
    openSmsApp(number);
  }
});

document.querySelector("#open-whatsapp")?.addEventListener("click", () => {
  if (!trustedNumber) return;
  const number = cleanPhoneNumber(trustedNumber.value);
  if (!number) return;
  if (!number.startsWith("+")) {
    messageAppDialog?.close();
    trustedDialog?.showModal();
    if (trustedStatus) {
      trustedStatus.textContent =
        "For WhatsApp, include the phone number's international country code, such as +91.";
    }
    trustedNumber.focus();
    return;
  }
  messageAppDialog?.close();
  const internationalDigits = number.replace(/\D/g, "");
  window.location.href =
    `https://wa.me/${internationalDigits}?text=${encodeURIComponent(suggestedMessage)}`;
});

document.querySelector("#open-sms")?.addEventListener("click", () => {
  if (!trustedNumber) return;
  const number = cleanPhoneNumber(trustedNumber.value);
  if (!number) return;
  messageAppDialog?.close();
  openSmsApp(number);
});

// Call a trusted contact
document.querySelector("#call-trusted")?.addEventListener("click", () => {
  if (!trustedNumber || !trustedStatus) return;
  const number = cleanPhoneNumber(trustedNumber.value);

  if (!number) {
    trustedStatus.textContent =
      "Enter the phone number of the person you want to call.";
    trustedNumber.focus();
    return;
  }

  window.location.href = `tel:${number}`;
});

// Copy the suggested message
document.querySelector("#copy-message")?.addEventListener("click", async (event) => {
  if (!trustedStatus) return;
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(suggestedMessage);

    button.innerHTML =
      '<span class="material-symbols-rounded" aria-hidden="true">check_circle</span><span>Text copied!</span>';
    trustedStatus.textContent = "Text copied. You can now paste it into a message.";
    window.setTimeout(() => {
      button.innerHTML =
        '<span class="material-symbols-rounded" aria-hidden="true">content_copy</span><span>Copy message</span>';
    }, 2500);
  } catch {
    trustedStatus.textContent =
      "Copy isn't available in this browser. You can select and copy the suggested message manually.";
  }
});

// Share the user's location voluntarily
document.querySelector("#share-location")?.addEventListener("click", () => {
  if (!trustedStatus) return;
  if (selectedLocation) {
    shareCurrentLocation(selectedLocation);
    return;
  }
  requestCurrentLocation();
});

function requestCurrentLocation() {
  if (!trustedStatus) return;
  if (!("geolocation" in navigator)) {
    trustedStatus.textContent =
      "Location isn't supported by this browser. You can share your location from your maps app instead.";
    return;
  }

  trustedStatus.textContent = "Requesting location permission from your browser…";

  try {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        selectedLocation = position;
        trustedStatus.textContent =
          "Location is available. Press “Share my location” when you're ready; it won't be sent automatically.";
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          trustedStatus.textContent =
            "Location permission wasn't granted. You can enable it in browser settings or continue without sharing location.";
        } else {
          trustedStatus.textContent =
            "Couldn't get your location. You can continue without sharing it or use your maps app.";
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 60000
      }
    );
  } catch {
    trustedStatus.textContent =
      "Couldn't request your location. You can share it from your maps app instead.";
  }
}

async function shareCurrentLocation(position) {
  if (!trustedStatus) return;
  const { latitude, longitude } = position.coords;
  const mapUrl = `https://maps.google.com/?q=${latitude},${longitude}`;
  const shareText = `I could use some support. Here's my current location: ${mapUrl}`;

  try {
    if (navigator.share) {
      await navigator.share({
        title: "My location",
        text: shareText,
        url: mapUrl
      });
      trustedStatus.textContent =
        "Sharing options opened. Choose a trusted person and send only if you want to.";
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(shareText);
      trustedStatus.textContent =
        "Location link copied. Paste it into a message to someone you trust.";
    } else {
      window.open(mapUrl, "_blank", "noopener,noreferrer");
      trustedStatus.textContent =
        "Your map opened. Share the location with someone you trust if you choose.";
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      trustedStatus.textContent =
        "Couldn't open sharing options. You can share your location directly from your maps app.";
    }
  }
}

function renderSelectedContacts(contacts) {
  if (!contactResults || !contactSearch || !trustedNumber) return;
  contactResults.replaceChildren();

  for (const contact of contacts) {
    const names = Array.isArray(contact.name) ? contact.name : [contact.name];
    const numbers = Array.isArray(contact.tel) ? contact.tel : [contact.tel];
    const name = names.find(Boolean) || "Contact";
    for (const phone of numbers.filter(Boolean)) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "contact-result";
      button.textContent = `${name} — ${phone}`;
      item.dataset.searchText = `${name} ${phone}`.toLocaleLowerCase();
      button.addEventListener("click", () => {
        trustedNumber.value = phone;
        if (trustedStatus) {
          trustedStatus.textContent = `${name} selected. Choose whether to call or message.`;
        }
      });
      item.append(button);
      contactResults.append(item);
    }
  }

  contactResults.hidden = contactResults.childElementCount === 0;
  contactSearch.disabled = contactResults.hidden;
}

function openSmsApp(number) {
  const body = encodeURIComponent(suggestedMessage);
  const separator = /iPad|iPhone|iPod/.test(navigator.userAgent) ? "&" : "?";
  window.location.href = `sms:${number}${separator}body=${body}`;
}

// Open the information dialog
document.querySelector("#info-button")?.addEventListener("click", () => {
  infoDialog?.showModal();
});

// Close the information dialog
document.querySelector("#close-info")?.addEventListener("click", () => {
  infoDialog?.close();
});

// Validate and clean phone numbers
function cleanPhoneNumber(value) {
  // Preserve a leading plus and digits only.
  const trimmed = value.trim();
  const cleaned = trimmed.replace(/[^\d+]/g, "");
  const digits = cleaned.replace(/\D/g, "");

  return digits.length >= 7 ? cleaned : "";
}

// Prevent unconfigured local contact links from being used.
for (const link of document.querySelectorAll('a[href^="tel:REPLACE_WITH_"]')) {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const contactName =
      link.dataset.placeholder || link.querySelector("strong")?.textContent || "This contact";
    alert(`${contactName} needs a verified contact number before deployment.`);
  });
}
