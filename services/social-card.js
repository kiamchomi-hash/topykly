import sharp from "sharp";

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function truncateText(value, limit) {
  const text = normalizeText(value);
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapText(value, maxChars, maxLines) {
  const text = normalizeText(value);
  const words = text.split(" ").filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
    }
    current = word;
    if (lines.length === maxLines) {
      break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  if (lines.join(" ").length < text.length && lines.length) {
    lines[lines.length - 1] = truncateText(lines[lines.length - 1], maxChars);
  }
  return lines;
}

function initialsFor(name) {
  return normalizeText(name)
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "T";
}

function renderTextLines(lines, { x, y, lineHeight, className }) {
  return lines.map((line, index) => (
    `<text x="${x}" y="${y + index * lineHeight}" class="${className}">${escapeXml(line)}</text>`
  )).join("");
}

async function renderAvatar(avatarBuffer, authorName) {
  const size = 196;
  const mask = Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/>
    </svg>
  `);

  if (avatarBuffer) {
    try {
      return await sharp(avatarBuffer)
        .resize(size, size, { fit: "cover", position: "centre" })
        .composite([{ input: mask, blend: "dest-in" }])
        .png()
        .toBuffer();
    } catch {
      // Una imagen dañada no debe impedir que el tema siga siendo compartible.
    }
  }

  const initials = escapeXml(initialsFor(authorName));
  return sharp(Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="98" cy="98" r="98" fill="#7c5cff"/>
      <circle cx="98" cy="98" r="90" fill="#241b32"/>
      <text x="98" y="116" text-anchor="middle" fill="#f8f5ff" font-family="Arial, sans-serif" font-size="54" font-weight="800">${initials}</text>
    </svg>
  `)).png().toBuffer();
}

export async function renderTopicSocialCard(topic, { avatarBuffer = null } = {}) {
  const rootMessage = topic.messages?.find((message) => message.isRoot) || topic.messages?.[0];
  const commentCount = Number(topic.commentCount || 0);
  const authorName = topic.author?.name || rootMessage?.authorName || "Comunidad TOPYKLY";
  const authorNickname = topic.author?.nickname || rootMessage?.authorNickname || "";
  const titleLines = wrapText(topic.title, 27, 3);
  const excerptLines = wrapText(rootMessage?.text || "Conversación abierta en TOPYKLY", 49, 3);
  const avatar = await renderAvatar(avatarBuffer, authorName);

  const svg = Buffer.from(`
    <svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .brand { fill: #f8f5ff; font: 800 38px Arial, sans-serif; letter-spacing: 2px; }
        .title { fill: #f8f5ff; font: 800 54px Arial, sans-serif; letter-spacing: -1px; }
        .excerpt { fill: #cfc5db; font: 400 25px Arial, sans-serif; }
        .author { fill: #f8f5ff; font: 750 25px Arial, sans-serif; }
        .nickname { fill: #a99dbc; font: 400 20px Arial, sans-serif; }
        .meta { fill: #b9a8ff; font: 700 20px Arial, sans-serif; letter-spacing: 1px; }
      </style>
      <defs>
        <clipPath id="author-column-clip">
          <rect x="52" y="410" width="274" height="48"/>
        </clipPath>
      </defs>
      <rect width="1200" height="630" fill="#14111d"/>
      <rect width="326" height="630" fill="#1d1728"/>
      <rect width="10" height="630" fill="#7c5cff"/>
      <rect x="326" y="0" width="874" height="8" fill="#ff8b5c"/>
      <circle cx="172" cy="278" r="112" fill="#2b203b"/>
      <path d="M1010 0h190v184L1070 54Z" fill="#241b32"/>

      <g transform="translate(52 48) scale(.82)">
        <rect width="64" height="64" rx="16" fill="#ff8b5c"/>
        <path d="M17 19h30v18c0 5.5-4.5 10-10 10H27c-5.5 0-10-4.5-10-10V19Z" fill="#fff7ef"/>
        <path d="M44 23h4.2c2.7 0 4.8 2.1 4.8 4.8s-2.1 4.8-4.8 4.8H44M22 48h20M26 14v7M32 11v10M38 14v7" stroke="#fff7ef" stroke-width="3" stroke-linecap="round" fill="none"/>
      </g>
      <text x="122" y="88" class="brand">TOPY<tspan fill="#ff8b5c">KLY</tspan></text>

      <text x="52" y="442" class="author" clip-path="url(#author-column-clip)">${escapeXml(truncateText(authorName, 18))}</text>
      <text x="52" y="474" class="nickname">${escapeXml(authorNickname ? `@${truncateText(authorNickname, 20)}` : "Autor del tema")}</text>

      ${renderTextLines(titleLines, { x: 378, y: 138, lineHeight: 64, className: "title" })}
      <rect x="378" y="${148 + titleLines.length * 64}" width="74" height="6" rx="3" fill="#ff8b5c"/>
      ${renderTextLines(excerptLines, { x: 378, y: 202 + titleLines.length * 64, lineHeight: 36, className: "excerpt" })}

      <line x1="378" y1="548" x2="1140" y2="548" stroke="#332940" stroke-width="2"/>
      <text x="378" y="586" class="meta">${commentCount} ${commentCount === 1 ? "COMENTARIO" : "COMENTARIOS"}</text>
      <text x="1140" y="586" text-anchor="end" class="meta" fill="#f8f5ff">TOPYKLY.COM</text>
    </svg>
  `);

  return sharp(svg)
    .composite([{ input: avatar, left: 74, top: 180 }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export const TOPIC_SOCIAL_CARD_SIZE = Object.freeze({ width: CARD_WIDTH, height: CARD_HEIGHT });
