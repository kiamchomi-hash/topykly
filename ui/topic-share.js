import { getSelectedTopic } from "../model.js";
import { slugify } from "../services/seo-pages.js";

const EXPORT_WIDTH = 1080;
const EXPORT_HEIGHT = 1350;

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function truncateText(value, limit) {
  const text = normalizeText(value);
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function getAuthor(topic, users) {
  const rootMessage = topic.messages?.find((message) => message.isRoot) || topic.messages?.[0];
  const authorId = rootMessage?.authorId || topic.authorId;
  const user = users?.find((entry) => entry.id === authorId);
  return {
    name: user?.name || rootMessage?.authorName || "Comunidad TOPYKLY",
    nickname: user?.nickname || "",
    avatarUrl: user?.avatarUrl || ""
  };
}

export function buildTopicSharePath(topic) {
  const slug = slugify(topic?.title || "");
  const encodedId = encodeURIComponent(topic?.id || "");
  return slug ? `/tema/${encodedId}/${slug}` : `/tema/${encodedId}`;
}

export function buildTopicShareModel(topic, users = [], origin = "https://www.topykly.com") {
  const rootMessage = topic?.messages?.find((message) => message.isRoot) || topic?.messages?.[0];
  const author = getAuthor(topic || {}, users);
  const commentCount = (topic?.messages || []).filter(
    (message) => message.kind !== "system" && !message.isRoot
  ).length;

  return {
    id: topic?.id || "",
    title: truncateText(topic?.title || "Tema de TOPYKLY", 120),
    excerpt: truncateText(
      rootMessage?.text || topic?.subtitle || "Conversación abierta en TOPYKLY.",
      300
    ),
    authorName: truncateText(author.name, 42),
    authorNickname: truncateText(author.nickname, 32),
    avatarUrl: author.avatarUrl,
    commentCount,
    commentLabel: commentCount === 1 ? "1 comentario" : `${commentCount} comentarios`,
    url: `${String(origin).replace(/\/$/, "")}${buildTopicSharePath(topic || {})}`
  };
}

function getCanvasPalette(documentRef) {
  if (!documentRef?.documentElement || typeof getComputedStyle !== "function") {
    return {
      background: "#15111d",
      surface: "#20182c",
      text: "#f7f3ff",
      muted: "#c9bdd8",
      accent: "#7c5cff",
      accentStrong: "#ff8b5c"
    };
  }

  const styles = getComputedStyle(documentRef.documentElement);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: read("--bg", "#15111d"),
    surface: read("--surface-strong", "#20182c"),
    text: read("--text", "#f7f3ff"),
    muted: read("--text-soft", "#c9bdd8"),
    accent: read("--accent", "#7c5cff"),
    accentStrong: read("--accent-strong", "#ff8b5c")
  };
}

function drawRoundedRect(context, x, y, width, height, radius, fillStyle) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fillStyle = fillStyle;
  context.fill();
}

function fitLines(context, value, maxWidth, maxLines) {
  const words = normalizeText(value).split(" ").filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth) {
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

  if (lines.join(" ").length < normalizeText(value).length && lines.length) {
    let finalLine = lines[lines.length - 1];
    while (finalLine && context.measureText(`${finalLine}...`).width > maxWidth) {
      finalLine = finalLine.slice(0, -1).trimEnd();
    }
    lines[lines.length - 1] = `${finalLine}...`;
  }
  return lines;
}

function drawLines(context, lines, x, y, lineHeight) {
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
}

function drawCupMark(context, x, y, size, palette) {
  const scale = size / 64;
  drawRoundedRect(context, x, y, size, size, 16 * scale, palette.accentStrong);
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  context.fillStyle = "#fff7ef";
  context.beginPath();
  context.roundRect(17, 19, 30, 28, 7);
  context.fill();
  context.strokeStyle = "#fff7ef";
  context.lineWidth = 3;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(44, 23);
  context.lineTo(48, 23);
  context.arc(48, 28, 5, -Math.PI / 2, Math.PI / 2);
  context.lineTo(44, 33);
  context.moveTo(22, 50);
  context.lineTo(42, 50);
  context.moveTo(26, 14);
  context.lineTo(26, 20);
  context.moveTo(32, 11);
  context.lineTo(32, 20);
  context.moveTo(38, 14);
  context.lineTo(38, 20);
  context.stroke();
  context.restore();
}

async function loadAvatarImage(avatarUrl) {
  if (!avatarUrl || typeof fetch !== "function" || typeof createImageBitmap !== "function") {
    return null;
  }
  try {
    const response = await fetch(avatarUrl, { credentials: "same-origin" });
    if (!response.ok) {
      return null;
    }
    return await createImageBitmap(await response.blob());
  } catch {
    return null;
  }
}

function drawAvatarFallback(context, model, x, y, size, palette) {
  context.fillStyle = palette.surface;
  context.beginPath();
  context.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = palette.accent;
  context.lineWidth = 8;
  context.stroke();
  context.fillStyle = palette.text;
  context.font = "900 56px Arial, sans-serif";
  context.textAlign = "center";
  const initials = model.authorName
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  context.fillText(initials || "T", x + size / 2, y + size / 2 + 19);
  context.textAlign = "left";
}

export async function drawTopicShareCard(
  canvas,
  model,
  { documentRef = globalThis.document } = {}
) {
  const context = canvas.getContext("2d");
  const palette = getCanvasPalette(documentRef);
  canvas.width = EXPORT_WIDTH;
  canvas.height = EXPORT_HEIGHT;

  context.fillStyle = palette.background;
  context.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);

  context.fillStyle = palette.accent;
  context.fillRect(0, 0, 16, EXPORT_HEIGHT);
  context.fillStyle = palette.accentStrong;
  context.fillRect(16, 0, EXPORT_WIDTH - 16, 14);

  drawCupMark(context, 72, 66, 68, palette);
  context.fillStyle = palette.text;
  context.font = "900 42px Arial, sans-serif";
  context.fillText("TOPY", 165, 113);
  context.fillStyle = palette.accentStrong;
  context.fillText("KLY", 280, 113);

  const avatarX = 72;
  const avatarY = 190;
  const avatarSize = 210;
  const avatarImage = await loadAvatarImage(model.avatarUrl);
  if (avatarImage) {
    context.save();
    context.beginPath();
    context.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    context.clip();
    const sourceSize = Math.min(avatarImage.width, avatarImage.height);
    const sourceX = (avatarImage.width - sourceSize) / 2;
    const sourceY = (avatarImage.height - sourceSize) / 2;
    context.drawImage(
      avatarImage,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      avatarX,
      avatarY,
      avatarSize,
      avatarSize
    );
    context.restore();
    avatarImage.close?.();
    context.strokeStyle = palette.accent;
    context.lineWidth = 8;
    context.beginPath();
    context.arc(
      avatarX + avatarSize / 2,
      avatarY + avatarSize / 2,
      avatarSize / 2 - 4,
      0,
      Math.PI * 2
    );
    context.stroke();
  } else {
    drawAvatarFallback(context, model, avatarX, avatarY, avatarSize, palette);
  }

  context.fillStyle = palette.text;
  context.font = "900 38px Arial, sans-serif";
  context.fillText(model.authorName, 320, 280);
  context.fillStyle = palette.muted;
  context.font = "500 27px Arial, sans-serif";
  context.fillText(model.authorNickname ? `@${model.authorNickname}` : "Autor del tema", 320, 330);
  context.fillStyle = palette.accent;
  context.font = "800 26px Arial, sans-serif";
  context.fillText(model.commentLabel, 320, 380);

  context.strokeStyle = palette.surface;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(72, 458);
  context.lineTo(1008, 458);
  context.stroke();

  context.fillStyle = palette.text;
  context.font = "900 70px Arial, sans-serif";
  const titleLines = fitLines(context, model.title, 900, 4);
  drawLines(context, titleLines, 72, 550, 80);

  const quoteY = 550 + titleLines.length * 80 + 20;
  context.fillStyle = palette.accentStrong;
  context.fillRect(72, quoteY, 74, 7);

  context.fillStyle = palette.muted;
  context.font = "500 34px Arial, sans-serif";
  const excerptLines = fitLines(context, model.excerpt, 900, 4);
  drawLines(context, excerptLines, 72, quoteY + 58, 48);

  const metaTop = 1200;
  context.strokeStyle = palette.surface;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(72, metaTop);
  context.lineTo(1008, metaTop);
  context.stroke();

  context.fillStyle = palette.text;
  context.font = "800 27px Arial, sans-serif";
  context.fillText("topykly.com", 72, 1260);
  context.textAlign = "right";
  context.fillStyle = palette.muted;
  context.font = "500 23px Arial, sans-serif";
  context.fillText("Comparte la conversación", 1008, 1260);
  context.textAlign = "left";

  return canvas;
}

function syncPreview(dom, model) {
  if (dom.sharePreviewTitle) {
    dom.sharePreviewTitle.textContent = model.title;
  }
  if (dom.sharePreviewExcerpt) {
    dom.sharePreviewExcerpt.textContent = model.excerpt;
  }
  if (dom.sharePreviewAuthor) {
    dom.sharePreviewAuthor.textContent = model.authorName;
  }
  if (dom.sharePreviewNickname) {
    dom.sharePreviewNickname.textContent = model.authorNickname
      ? `@${model.authorNickname}`
      : "Autor del tema";
  }
  if (dom.sharePreviewComments) {
    dom.sharePreviewComments.textContent = model.commentLabel;
  }
  if (dom.sharePreviewAvatar instanceof HTMLImageElement && dom.sharePreviewAvatarFallback) {
    dom.sharePreviewAvatar.hidden = !model.avatarUrl;
    dom.sharePreviewAvatarFallback.hidden = Boolean(model.avatarUrl);
    dom.sharePreviewAvatar.src = model.avatarUrl || "";
    dom.sharePreviewAvatar.alt = model.avatarUrl ? `Foto de ${model.authorName}` : "";
    dom.sharePreviewAvatar.onerror = () => {
      dom.sharePreviewAvatar.hidden = true;
      dom.sharePreviewAvatarFallback.hidden = false;
    };
    dom.sharePreviewAvatarFallback.textContent =
      model.authorName
        .split(" ")
        .filter(Boolean)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "T";
  }
  if (dom.shareTopicUrl) {
    dom.shareTopicUrl.value = model.url;
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("No se pudo generar la imagen."));
      },
      "image/png",
      0.94
    );
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function bindTopicShareEvents(dom, handlers) {
  let activeModel = null;
  let trigger = null;

  const close = () => {
    if (!dom.shareTopicModalBackdrop || dom.shareTopicModalBackdrop.hidden) {
      return;
    }
    dom.shareTopicModalBackdrop.hidden = true;
    dom.shareTopicModal?.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-topic-share-open");
    trigger?.focus?.();
    trigger = null;
  };

  const open = () => {
    const topic = getSelectedTopic(handlers.state?.topics || [], handlers.state?.selectedTopicId);
    if (!topic) {
      return;
    }
    activeModel = buildTopicShareModel(topic, handlers.state?.users || [], window.location.origin);
    syncPreview(dom, activeModel);
    trigger = dom.shareTopicButton;
    dom.shareTopicModalBackdrop.hidden = false;
    dom.shareTopicModal?.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-topic-share-open");
    requestAnimationFrame(() => dom.closeShareTopicModalButton?.focus?.());
  };

  dom.shareTopicButton?.addEventListener("click", open);
  dom.closeShareTopicModalButton?.addEventListener("click", close);
  dom.shareTopicModalBackdrop?.addEventListener("click", (event) => {
    if (event.target === dom.shareTopicModalBackdrop) {
      close();
    }
  });

  dom.copyTopicLinkButton?.addEventListener("click", async () => {
    if (!activeModel) {
      return;
    }
    const copied = await handlers.copyText?.(activeModel.url);
    handlers.showFeedback?.(
      copied ? "Enlace del tema copiado." : "No se pudo copiar el enlace.",
      copied ? undefined : { kind: "error" }
    );
  });

  dom.nativeShareTopicButton?.addEventListener("click", async () => {
    if (!activeModel) {
      return;
    }
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: `${activeModel.title} — TOPYKLY`,
          text: activeModel.excerpt,
          url: activeModel.url
        });
        return;
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }
      }
    }
    const copied = await handlers.copyText?.(activeModel.url);
    handlers.showFeedback?.(
      copied ? "Enlace listo para compartir." : "No se pudo compartir el tema.",
      copied ? undefined : { kind: "error" }
    );
  });

  dom.downloadTopicCardButton?.addEventListener("click", async () => {
    if (!activeModel || !dom.topicShareCanvas) {
      return;
    }
    const button = dom.downloadTopicCardButton;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      await drawTopicShareCard(dom.topicShareCanvas, activeModel);
      const blob = await canvasToBlob(dom.topicShareCanvas);
      downloadBlob(blob, `topykly-${slugify(activeModel.title) || "tema"}.png`);
      handlers.showFeedback?.("Imagen del tema descargada.");
    } catch {
      handlers.showFeedback?.("No se pudo generar la imagen.", { kind: "error" });
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  });

  return { close };
}

export const TOPIC_SHARE_EXPORT_SIZE = Object.freeze({
  width: EXPORT_WIDTH,
  height: EXPORT_HEIGHT
});
