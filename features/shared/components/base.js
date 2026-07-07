export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

export function createProfileAvatar(className = "topic-item__avatar") {
  const avatar = el("span", className);
  avatar.setAttribute("aria-hidden", "true");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("width", "84");
  svg.setAttribute("height", "84");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");

  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", "4");
  rect.setAttribute("y", "4");
  rect.setAttribute("width", "40");
  rect.setAttribute("height", "40");
  rect.setAttribute("rx", "10");

  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "24");
  circle.setAttribute("cy", "18");
  circle.setAttribute("r", "7");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M11.5 38c2.6-6.2 7.7-9.3 12.5-9.3S33.9 31.8 36.5 38");

  svg.append(rect, circle, path);
  avatar.appendChild(svg);
  return avatar;
}
