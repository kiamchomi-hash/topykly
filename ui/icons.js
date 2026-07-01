/**
 * Centralized Icon System for TOPYKLY.
 * Returns SVG elements or pre-built icon nodes.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

const iconPaths = {
  avatar: `
    <rect x="4" y="4" width="40" height="40" rx="10"></rect>
    <circle cx="24" cy="18" r="7"></circle>
    <path d="M11.5 38c2.6-6.2 7.7-9.3 12.5-9.3S33.9 31.8 36.5 38"></path>
  `,
  userProfile: `
    <circle cx="12" cy="8.5" r="3.2"></circle>
    <path d="M5.5 19c1.4-3.6 4-5.4 6.5-5.4s5.1 1.8 6.5 5.4"></path>
  `,
  userMessage: `
    <path d="M5 6.5h14v8H9.2L6 17.5V14.5H5z"></path>
    <path d="M9 10h6"></path>
  `
};

/**
 * Creates an SVG element with the given path and attributes.
 */
export function createIcon(name, options = {}) {
  const { 
    viewBox = "0 0 24 24", 
    strokeWidth = "1.8", 
    className = "",
    size = null
  } = options;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", strokeWidth);
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  
  if (className) {
    svg.classList.add(...className.split(" "));
  }
  
  if (size) {
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
  }

  svg.innerHTML = iconPaths[name] || "";
  return svg;
}

/**
 * Specialized avatar creator to match existing component logic.
 */
export function createAvatarIcon(className = "topic-item__avatar") {
  const container = document.createElement("span");
  container.className = className;
  container.setAttribute("aria-hidden", "true");
  
  const svg = createIcon("avatar", { viewBox: "0 0 48 48", strokeWidth: "0" });
  // Avatar uses fills for parts of the rect/circle/path logic in CSS 
  // but the current JS sets them as elements. 
  // Let's refine the paths to be clean.
  
  container.appendChild(svg);
  return container;
}
