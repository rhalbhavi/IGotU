
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

// Open the trusted contact dialog
document.querySelector("#trusted-button")?.addEventListener("click", () => {
  if (!trustedDialog || !trustedStatus) return;
  trustedStatus.textContent = "";
  trustedDialog.showModal();
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
