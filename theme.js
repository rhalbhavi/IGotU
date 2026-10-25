const themeToggle = document.querySelector("#theme-toggle");
const themeIcon = document.querySelector("#theme-icon");
const theme = localStorage.getItem("igotu-theme") === "dark" ? "dark" : "light";

document.documentElement.dataset.theme = theme;
updateThemeButton(theme);

themeToggle?.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem("igotu-theme", nextTheme);
  updateThemeButton(nextTheme);
});

function updateThemeButton(theme) {
  if (!themeToggle || !themeIcon) return;
  const isDark = theme === "dark";
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} mode`);
  themeIcon.textContent = isDark ? "light_mode" : "dark_mode";
}
