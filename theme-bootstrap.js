(function () {
  const theme = localStorage.getItem("topykly-theme") || localStorage.getItem("chetrend-theme") || "dark";
  const palette = localStorage.getItem("topykly-palette") || localStorage.getItem("chetrend-palette") || "default";
  const authState = "logged-out";
  const mobile = typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 960px)").matches
    : window.innerWidth <= 960;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.palette = palette;
  document.documentElement.dataset.authState = authState;
  document.documentElement.classList.toggle("is-mobile-viewport", mobile);
  document.documentElement.classList.toggle("is-desktop-viewport", !mobile);
})();
