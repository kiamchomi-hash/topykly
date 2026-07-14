(function () {
  const template = document.getElementById("themeToggleTemplate");
  const preferredSlot = document.documentElement.classList.contains("is-mobile-viewport")
    ? document.getElementById("themeToggleMobileSlot")
    : document.getElementById("themeToggleDesktopSlot");
  const targetSlot = preferredSlot || document.getElementById("themeToggleDesktopSlot");
  if (template instanceof HTMLTemplateElement && targetSlot && !targetSlot.firstElementChild) {
    targetSlot.appendChild(template.content.cloneNode(true));
  }
  const themeToggle = targetSlot?.querySelector?.("#themeToggle");
  if (themeToggle instanceof HTMLButtonElement) {
    const isDark = document.documentElement.dataset.theme !== "light";
    themeToggle.setAttribute("aria-checked", String(isDark));
    themeToggle.setAttribute("title", isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro");
  }
})();
