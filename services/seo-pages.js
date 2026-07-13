const HTML_ESCAPES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ["\"", "&quot;"],
  ["'", "&#39;"]
]);

export const DEFAULT_PUBLIC_ORIGIN = "https://topykly.com";
export const SEO_THIN_TOPIC_COMMENT_COUNT = 3;

export function resolvePublicOrigin(env = process.env) {
  const raw = String(env.TOPYKLY_PUBLIC_ORIGIN || env.CHETREND_PUBLIC_ORIGIN || "").trim();
  if (!raw) {
    return DEFAULT_PUBLIC_ORIGIN;
  }

  try {
    return new URL(raw).origin;
  } catch {
    return DEFAULT_PUBLIC_ORIGIN;
  }
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (match) => HTML_ESCAPES.get(match));
}

export function serializeJsonLd(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function slugify(title) {
  return String(title || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

function formatDate(isoDate) {
  const date = new Date(isoDate || "");
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    line-height: 1.55;
    background: #f6f4fb;
    color: #241f33;
  }
  a { color: #6d4ce0; }
  .seo-shell { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }
  .seo-brand { display: inline-block; font-weight: 800; font-size: 1.1rem; letter-spacing: 0.08em; text-decoration: none; color: inherit; }
  .seo-title { margin: 16px 0 4px; font-size: 1.6rem; line-height: 1.25; }
  .seo-meta { margin: 0 0 20px; font-size: 0.9rem; opacity: 0.75; }
  .seo-cta {
    display: inline-block;
    margin: 20px 0;
    padding: 10px 18px;
    border-radius: 999px;
    background: #6d4ce0;
    color: #fff;
    font-weight: 600;
    text-decoration: none;
  }
  .seo-message { padding: 12px 14px; margin: 0 0 10px; border-radius: 12px; background: rgba(109, 76, 224, 0.07); }
  .seo-message--root { background: rgba(109, 76, 224, 0.14); }
  .seo-message__meta { font-size: 0.82rem; opacity: 0.7; margin-top: 6px; }
  .seo-message__author { font-weight: 700; margin-right: 6px; }
  .seo-list { list-style: none; padding: 0; margin: 0; }
  .seo-list li { margin: 0 0 10px; }
  .seo-list a { font-weight: 600; text-decoration: none; }
  .seo-list .seo-item-meta { display: block; font-size: 0.82rem; opacity: 0.7; }
  .seo-section-title { margin: 32px 0 12px; font-size: 1.05rem; }
  .seo-footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid rgba(36, 31, 51, 0.15); font-size: 0.85rem; }
  .seo-footer a { margin-right: 14px; }
  @media (prefers-color-scheme: dark) {
    body { background: #17131f; color: #efeaf7; }
    a { color: #a68cff; }
    .seo-message { background: rgba(166, 140, 255, 0.09); }
    .seo-message--root { background: rgba(166, 140, 255, 0.16); }
    .seo-footer { border-top-color: rgba(239, 234, 247, 0.15); }
  }
`;

export function renderPageShell({
  title,
  description = "",
  canonicalUrl = "",
  robotsMeta = "index,follow",
  jsonLd = null,
  ogType = "website",
  ogImage = "",
  bodyHtml = "",
  redirectUrl = ""
}) {
  const head = [
    redirectUrl ? `<script>window.location.replace(${JSON.stringify(redirectUrl)});</script>` : "",
    `<meta charset="UTF-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
    `<title>${escapeHtml(title)}</title>`,
    description ? `<meta name="description" content="${escapeHtml(description)}">` : "",
    `<meta name="robots" content="${escapeHtml(robotsMeta)}">`,
    canonicalUrl ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">` : "",
    `<meta property="og:site_name" content="TOPYKLY">`,
    `<meta property="og:type" content="${escapeHtml(ogType)}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    description ? `<meta property="og:description" content="${escapeHtml(description)}">` : "",
    canonicalUrl ? `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">` : "",
    `<meta property="og:locale" content="es_ES">`,
    ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : "",
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    description ? `<meta name="twitter:description" content="${escapeHtml(description)}">` : "",
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`,
    `<style>${PAGE_STYLE}</style>`,
    jsonLd ? `<script type="application/ld+json">${serializeJsonLd(jsonLd)}</script>` : ""
  ].filter(Boolean).join("\n    ");

  return `<!DOCTYPE html>
<html lang="es">
  <head>
    ${head}
  </head>
  <body>
    <div class="seo-shell">
      <a class="seo-brand" href="/">TOPYKLY</a>
      ${bodyHtml}
      <footer class="seo-footer">
        <a href="/">Inicio</a>
        <a href="/temas">Temas</a>
        <a href="/terms.html">Términos</a>
      </footer>
    </div>
  </body>
</html>
`;
}

function renderMessageBlock(message) {
  const authorLabel = message.authorNickname && message.authorType === "registered"
    ? `<a class="seo-message__author" href="/u/${escapeHtml(encodeURIComponent(message.authorNickname))}">${escapeHtml(message.authorName)}</a>`
    : `<span class="seo-message__author">${escapeHtml(message.authorName)}</span>`;
  const likesLabel = message.likes > 0
    ? ` · ${message.likes === 1 ? "1 like" : `${message.likes} likes`}`
    : "";

  return `<div class="seo-message${message.isRoot ? " seo-message--root" : ""}">
        <p>${escapeHtml(message.text)}</p>
        <p class="seo-message__meta">${authorLabel}${escapeHtml(formatDate(message.createdAt))}${likesLabel}</p>
      </div>`;
}

function buildTopicDescription(topic) {
  const rootText = topic.messages.find((message) => message.isRoot)?.text || "";
  const base = rootText || topic.title;
  const commentLabel = topic.commentCount === 1 ? "1 comentario" : `${topic.commentCount} comentarios`;
  const summary = base.length > 150 ? `${base.slice(0, 147)}...` : base;
  return `${summary} — ${commentLabel} en TOPYKLY.`;
}

export function topicPath(topic) {
  const slug = slugify(topic.title);
  return slug ? `/tema/${topic.id}/${slug}` : `/tema/${topic.id}`;
}

export function renderTopicPage(topic, { origin }) {
  const canonicalUrl = `${origin}${topicPath(topic)}`;
  const isIndexable = !topic.isThin && !topic.isExpelled && !topic.isBlocked;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "DiscussionForumPosting",
    headline: topic.title,
    url: canonicalUrl,
    datePublished: topic.createdAt,
    dateModified: topic.lastActivityAt || topic.createdAt,
    author: {
      "@type": "Person",
      name: topic.author?.name || "Usuario de TOPYKLY"
    },
    commentCount: topic.commentCount,
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: "https://schema.org/LikeAction",
      userInteractionCount: topic.likeCount
    }
  };
  if (topic.author?.nickname && topic.author?.type === "registered") {
    jsonLd.author.url = `${origin}/u/${encodeURIComponent(topic.author.nickname)}`;
  }

  const commentLabel = topic.commentCount === 1 ? "1 comentario" : `${topic.commentCount} comentarios`;
  const relatedItems = (topic.relatedTopics || [])
    .map((related) => `<li><a href="${escapeHtml(topicPath(related))}">${escapeHtml(related.title)}</a></li>`)
    .join("\n        ");

  const bodyHtml = `<article>
        <h1 class="seo-title">${escapeHtml(topic.title)}</h1>
        <p class="seo-meta">Por ${escapeHtml(topic.author?.name || "Usuario de TOPYKLY")} · ${escapeHtml(formatDate(topic.createdAt))} · ${escapeHtml(commentLabel)}</p>
        ${topic.messages.map(renderMessageBlock).join("\n      ")}
        <a class="seo-cta" href="/?selectedTopicId=${escapeHtml(encodeURIComponent(topic.id))}">Abrir en TOPYKLY</a>
      </article>
      ${relatedItems ? `<h2 class="seo-section-title">Otros temas activos</h2>\n      <ul class="seo-list">\n        ${relatedItems}\n      </ul>` : ""}`;

  return renderPageShell({
    title: `${topic.title} — TOPYKLY`,
    description: buildTopicDescription(topic),
    canonicalUrl,
    robotsMeta: isIndexable ? "index,follow" : "noindex,follow",
    jsonLd,
    ogType: "article",
    ogImage: `${origin}/og-image.png`,
    bodyHtml,
    redirectUrl: `/?selectedTopicId=${encodeURIComponent(topic.id)}`
  });
}

export function renderTopicsIndexPage(topics, { origin }) {
  const items = topics
    .map((topic) => {
      const commentLabel = topic.commentCount === 1 ? "1 comentario" : `${topic.commentCount} comentarios`;
      return `<li>
          <a href="${escapeHtml(topicPath(topic))}">${escapeHtml(topic.title)}</a>
          <span class="seo-item-meta">${escapeHtml(commentLabel)} · última actividad ${escapeHtml(formatDate(topic.lastActivityAt))}</span>
        </li>`;
    })
    .join("\n        ");

  const bodyHtml = `<h1 class="seo-title">Temas activos en TOPYKLY</h1>
      <p class="seo-meta">Conversaciones abiertas ahora en la comunidad.</p>
      ${topics.length ? `<ul class="seo-list">\n        ${items}\n      </ul>` : "<p>No hay temas activos en este momento.</p>"}
      <a class="seo-cta" href="/">Abrir TOPYKLY</a>`;

  return renderPageShell({
    title: "Temas activos — TOPYKLY",
    description: "Lista de temas activos en TOPYKLY, la comunidad para conversar por temas, descubrir rankings y conectar con usuarios.",
    canonicalUrl: `${origin}/temas`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Temas activos — TOPYKLY",
      url: `${origin}/temas`
    },
    bodyHtml,
    redirectUrl: "/"
  });
}

export function renderProfilePage(profile, { origin }) {
  const canonicalUrl = `${origin}/u/${encodeURIComponent(profile.nickname)}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: canonicalUrl,
    mainEntity: {
      "@type": "Person",
      name: profile.name,
      alternateName: profile.nickname,
      ...(profile.description ? { description: profile.description } : {}),
      ...(profile.avatarUrl ? { image: `${origin}${profile.avatarUrl}` } : {})
    }
  };

  const stats = [];
  if (Number.isFinite(profile.postCount)) {
    stats.push(`${profile.postCount === 1 ? "1 tema" : `${profile.postCount} temas`}`);
  }
  if (Number.isFinite(profile.commentCount)) {
    stats.push(`${profile.commentCount === 1 ? "1 comentario" : `${profile.commentCount} comentarios`}`);
  }
  if (Number.isFinite(profile.likeCount)) {
    stats.push(`${profile.likeCount === 1 ? "1 like recibido" : `${profile.likeCount} likes recibidos`}`);
  }

  const topicItems = (profile.recentTopics || [])
    .map((topic) => `<li><a href="${escapeHtml(topicPath(topic))}">${escapeHtml(topic.title)}</a></li>`)
    .join("\n        ");

  const bodyHtml = `<article>
        <h1 class="seo-title">${escapeHtml(profile.name)} <span class="seo-meta">@${escapeHtml(profile.nickname)}</span></h1>
        ${profile.joinedAt ? `<p class="seo-meta">Miembro desde ${escapeHtml(formatDate(profile.joinedAt))}</p>` : ""}
        ${profile.description ? `<p>${escapeHtml(profile.description)}</p>` : ""}
        ${stats.length ? `<p class="seo-meta">${escapeHtml(stats.join(" · "))}</p>` : ""}
        <a class="seo-cta" href="/?perfil=${escapeHtml(encodeURIComponent(profile.nickname))}">Abrir en TOPYKLY</a>
      </article>
      ${topicItems ? `<h2 class="seo-section-title">Últimos temas de @${escapeHtml(profile.nickname)}</h2>\n      <ul class="seo-list">\n        ${topicItems}\n      </ul>` : ""}`;

  return renderPageShell({
    title: `${profile.name} (@${profile.nickname}) — TOPYKLY`,
    description: profile.description
      ? `${profile.description} — Perfil de @${profile.nickname} en TOPYKLY.`
      : `Perfil público de @${profile.nickname} en TOPYKLY, la comunidad para conversar por temas.`,
    canonicalUrl,
    robotsMeta: profile.indexable ? "index,follow" : "noindex,follow",
    jsonLd,
    ogType: "profile",
    ogImage: profile.avatarUrl ? `${origin}${profile.avatarUrl}` : `${origin}/og-image.png`,
    bodyHtml,
    redirectUrl: `/?perfil=${encodeURIComponent(profile.nickname)}`
  });
}

export function renderNotFoundPage() {
  return renderPageShell({
    title: "Página no encontrada — TOPYKLY",
    description: "",
    robotsMeta: "noindex,follow",
    bodyHtml: `<h1 class="seo-title">Página no encontrada</h1>
      <p>El contenido que buscás no existe o dejó de estar disponible.</p>
      <a class="seo-cta" href="/">Abrir TOPYKLY</a>`
  });
}

export function renderSitemap(entries) {
  const urls = entries
    .map((entry) => {
      const lastmod = entry.lastmod ? `\n    <lastmod>${escapeHtml(new Date(entry.lastmod).toISOString())}</lastmod>` : "";
      return `  <url>\n    <loc>${escapeHtml(entry.loc)}</loc>${lastmod}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export function renderRobots({ origin }) {
  return `User-agent: *
Disallow: /api/
Disallow: /avatars/
Disallow: /dashboard.html
Allow: /

Sitemap: ${origin}/sitemap.xml
`;
}
