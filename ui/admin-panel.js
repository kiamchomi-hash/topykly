function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

const REPORT_GROUPS = [
  { type: "message", title: "Comentarios", empty: "No hay comentarios reportados." },
  { type: "topic", title: "Temas", empty: "No hay temas reportados." },
  { type: "user", title: "Usuarios", empty: "No hay usuarios reportados." }
];
let lastRenderedDashboard = null;
let lastRenderedSection = "";
let lastRenderedConfirmKey = "";

function renderEmpty(text) {
  return el("p", "admin-panel__empty", text);
}

function formatAdminDate(value) {
  if (!value) {
    return "Sin fecha";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Sin fecha";
  }
  return new Intl.DateTimeFormat("es", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function createAdminActionButton(label, actionType, targetType, targetId, isConfirming, tone = "neutral") {
  const button = el(
    "button",
    `admin-panel__action admin-panel__action--${tone}${isConfirming ? " is-confirming" : ""}`,
    isConfirming ? "Confirmar accion" : label
  );
  button.type = "button";
  button.dataset.adminAction = actionType;
  button.dataset.targetType = targetType;
  button.dataset.targetId = targetId;
  return button;
}

function renderAvatarItem(item) {
  const node = el("article", "admin-panel__item admin-panel__item--avatar");
  const imageWrap = el("div", "admin-panel__avatar-preview");
  const image = document.createElement("img");
  image.src = item.avatarPendingUrl;
  image.alt = `Foto pendiente de ${item.name || "usuario"}`;
  image.width = 64;
  image.height = 64;
  image.loading = "lazy";
  imageWrap.append(image);

  const info = el("div", "admin-panel__item-info");
  info.append(
    el("span", "admin-panel__eyebrow", "Identidad visual"),
    el("strong", "admin-panel__item-title", item.name || "Usuario"),
    el("span", "admin-panel__item-meta", item.email || item.userId)
  );

  const actions = el("div", "admin-panel__item-actions");
  actions.append(
    createAdminActionButton("Aprobar", "approve_avatar", "user", item.userId, false, "primary"),
    createAdminActionButton("Rechazar", "reject_avatar", "user", item.userId, false)
  );

  node.append(imageWrap, info, actions);
  return node;
}

function getReportContent(report) {
  const target = report.target;
  if (report.entityType === "message" && target) {
    return {
      title: target.text || "Comentario eliminado",
      subtitle: `De ${target.authorName} en ${target.topicTitle}`,
      authorId: target.authorId,
      sanction: target.sanction
    };
  }
  if (report.entityType === "topic" && target) {
    return {
      title: target.title || "Tema eliminado",
      subtitle: `Creado por ${target.authorName}`,
      authorId: target.authorId,
      sanction: target.sanction
    };
  }
  if (report.entityType === "user" && target) {
    return {
      title: target.name || "Usuario eliminado",
      subtitle: target.status === "expelled" ? "Usuario con sancion permanente" : "Perfil de usuario",
      authorId: report.entityId,
      sanction: target.sanction
    };
  }
  return {
    title: `${report.entityType}: ${report.entityId}`,
    subtitle: "Contenido no disponible",
    authorId: null,
    sanction: null
  };
}

function renderReportItem(report, adminConfirmAction) {
  const node = el("article", "admin-panel__item admin-panel__item--report");
  const content = getReportContent(report);
  const info = el("div", "admin-panel__item-info");
  const context = el("div", "admin-panel__report-context");
  context.append(
    el("span", "admin-panel__eyebrow", `Reporte #${report.id}`),
    el("span", "admin-panel__item-meta", formatAdminDate(report.createdAt))
  );
  info.append(
    context,
    el("strong", "admin-panel__item-title", content.title),
    el("span", "admin-panel__item-meta", content.subtitle),
    el("p", "admin-panel__reason", report.reason || "Sin motivo detallado"),
    el("span", "admin-panel__reporter", `Reportado por ${report.reporterName || "Anonimo"}`)
  );

  const actions = el("div", "admin-panel__item-actions");
  const actionKey = (actionType, targetType, targetId) => `${actionType}:${targetType}:${targetId}`;
  const isConfirming = (actionType, targetType, targetId) => (
    adminConfirmAction?.key === actionKey(actionType, targetType, targetId)
  );

  if (report.entityType === "message" && report.target) {
    actions.append(createAdminActionButton(
      "Eliminar comentario",
      "delete_message",
      "message",
      report.entityId,
      isConfirming("delete_message", "message", report.entityId),
      "danger"
    ));
  }
  if (report.entityType === "topic" && report.target) {
    actions.append(createAdminActionButton(
      "Bloquear tema",
      "block_topic",
      "topic",
      report.entityId,
      isConfirming("block_topic", "topic", report.entityId),
      "danger"
    ));
  }
  if (content.authorId && !content.sanction?.active) {
    const nextLabel = content.sanction?.nextLabel || "24 horas";
    actions.append(createAdminActionButton(
      `Sancion progresiva · ${nextLabel}`,
      "expel_user",
      "user",
      content.authorId,
      isConfirming("expel_user", "user", content.authorId),
      "warning"
    ));
  }
  actions.append(createAdminActionButton(
    "Descartar reporte",
    "dismiss_report",
    report.entityType,
    report.entityId,
    false
  ));

  node.append(info, actions);
  return node;
}

function renderSanctionItem(item, adminConfirmAction) {
  const node = el("article", "admin-panel__item admin-panel__item--sanction");
  const info = el("div", "admin-panel__item-info");
  const until = item.kind === "permanent"
    ? "Sin fecha de finalizacion"
    : `Finaliza ${formatAdminDate(item.bannedUntil)}`;
  info.append(
    el("span", "admin-panel__eyebrow", item.kind === "permanent" ? "Sancion permanente" : "Suspension activa"),
    el("strong", "admin-panel__item-title", item.name || item.userId),
    el("span", "admin-panel__item-meta", `${item.label} · ${until}`),
    el("p", "admin-panel__reason", item.reason || "Sin motivo detallado")
  );

  const key = `restore_user:user:${item.userId}`;
  const actions = el("div", "admin-panel__item-actions");
  actions.append(createAdminActionButton(
    "Anular sancion",
    "restore_user",
    "user",
    item.userId,
    adminConfirmAction?.key === key,
    "danger"
  ));
  node.append(info, actions);
  return node;
}

function renderSection(title, count, children, description = "") {
  const section = el("section", "admin-panel__section");
  const header = el("div", "admin-panel__section-header");
  const heading = el("div", "admin-panel__section-heading");
  heading.append(el("h3", "", title));
  if (description) {
    heading.append(el("p", "", description));
  }
  header.append(heading, el("span", "admin-panel__count", String(count)));
  const list = el("div", "admin-panel__list");
  children.forEach((child) => list.append(child));
  section.append(header, list);
  return section;
}

function createAdminNavigation(activeSection, counts) {
  const nav = el("nav", "admin-panel__nav");
  nav.setAttribute("aria-label", "Tipos de moderacion");
  [
    { id: "reports", label: "Reportes", count: counts.reports },
    { id: "avatars", label: "Fotos", count: counts.avatars },
    { id: "sanctions", label: "Sanciones", count: counts.sanctions }
  ].forEach((item) => {
    const button = el("button", `admin-panel__nav-button${activeSection === item.id ? " is-active" : ""}`);
    button.type = "button";
    button.dataset.adminSection = item.id;
    button.setAttribute("aria-pressed", String(activeSection === item.id));
    button.append(el("span", "", item.label), el("strong", "", String(item.count)));
    nav.append(button);
  });
  return nav;
}

function syncAdminButton(state, dom) {
  const count = state.pendingModerationCount || 0;
  const buttons = [
    dom.adminPanelButton,
    ...(dom.mobileTopbarMenu?.querySelectorAll?.("[data-admin-private]") || [])
  ].filter(Boolean);

  buttons.forEach((button) => {
    button.setAttribute("aria-expanded", String(Boolean(state.isAdminPanelOpen)));
    if (count > 0) {
      button.dataset.pendingModeration = count > 99 ? "99+" : String(count);
      button.setAttribute("title", `Administracion (${count} pendientes)`);
    } else {
      delete button.dataset.pendingModeration;
      button.setAttribute("title", "Administracion");
    }
  });
}

export function renderAdminPanel(state, dom) {
  syncAdminButton(state, dom);

  const isOpen = Boolean(state.isAdminPanelOpen);
  const dashboard = state.adminDashboard || {};
  const pendingAvatars = Array.isArray(dashboard.pendingAvatars) ? dashboard.pendingAvatars : [];
  const reports = Array.isArray(dashboard.reports) ? dashboard.reports : [];
  const activeSanctions = Array.isArray(dashboard.activeSanctions) ? dashboard.activeSanctions : [];
  const avatarCount = Number.isFinite(dashboard.avatarPagination?.total)
    ? dashboard.avatarPagination.total
    : pendingAvatars.length;
  const reportCount = Number.isFinite(dashboard.reportPagination?.total)
    ? dashboard.reportPagination.total
    : reports.length;
  const activeSection = ["reports", "avatars", "sanctions"].includes(state.adminSection)
    ? state.adminSection
    : "reports";

  if (dom.adminModalBackdrop) {
    dom.adminModalBackdrop.hidden = !isOpen;
  }
  if (dom.adminModal) {
    dom.adminModal.setAttribute("aria-hidden", String(!isOpen));
  }
  if (!dom.adminPanelBody) {
    return;
  }

  const confirmKey = state.adminConfirmAction?.key || "";
  if (
    dom.adminPanelBody.childElementCount > 0 &&
    lastRenderedDashboard === dashboard &&
    lastRenderedSection === activeSection &&
    lastRenderedConfirmKey === confirmKey
  ) {
    return;
  }

  lastRenderedDashboard = dashboard;
  lastRenderedSection = activeSection;
  lastRenderedConfirmKey = confirmKey;

  dom.adminPanelBody.textContent = "";
  dom.adminPanelBody.append(createAdminNavigation(activeSection, {
    reports: reportCount,
    avatars: avatarCount,
    sanctions: activeSanctions.length
  }));

  const workspace = el("div", "admin-panel__workspace");
  if (!dashboard.loaded && isOpen) {
    workspace.append(renderEmpty("Cargando la cola de moderacion..."));
    dom.adminPanelBody.append(workspace);
    return;
  }

  if (activeSection === "avatars") {
    workspace.append(renderSection(
      "Fotos de perfil",
      avatarCount,
      pendingAvatars.length ? pendingAvatars.map(renderAvatarItem) : [renderEmpty("No hay fotos para revisar.")],
      "Aprueba o rechaza imagenes antes de que aparezcan publicamente."
    ));
  } else if (activeSection === "sanctions") {
    workspace.append(renderSection(
      "Sanciones activas",
      activeSanctions.length,
      activeSanctions.length
        ? activeSanctions.map((item) => renderSanctionItem(item, state.adminConfirmAction))
        : [renderEmpty("No hay usuarios con sanciones activas.")],
      "Puedes anular una suspension o expulsion que se haya aplicado por error."
    ));
  } else {
    REPORT_GROUPS.forEach((group) => {
      const items = reports.filter((report) => report.entityType === group.type);
      workspace.append(renderSection(
        group.title,
        items.length,
        items.length
          ? items.map((report) => renderReportItem(report, state.adminConfirmAction))
          : [renderEmpty(group.empty)]
      ));
    });
  }

  dom.adminPanelBody.append(workspace);
}
