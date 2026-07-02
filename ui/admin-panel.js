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

function renderEmpty(text) {
  return el("p", "admin-panel__empty", text);
}

function renderAvatarItem(item) {
  const node = el("article", "admin-panel__item admin-panel__item--avatar");
  const imageWrap = el("div", "admin-panel__avatar-preview");
  const image = document.createElement("img");
  image.src = item.avatarPendingUrl;
  image.alt = "";
  image.loading = "lazy";
  imageWrap.append(image);

  const info = el("div", "admin-panel__item-info");
  info.append(
    el("strong", "admin-panel__item-title", item.name || "Usuario"),
    el("span", "admin-panel__item-meta", item.email || item.userId)
  );

  const actions = el("div", "admin-panel__item-actions");
  const approve = el("button", "primary-button admin-panel__action", "Aprobar");
  approve.type = "button";
  approve.dataset.adminAction = "approve_avatar";
  approve.dataset.targetType = "user";
  approve.dataset.targetId = item.userId;
  const reject = el("button", "text-button admin-panel__action", "Rechazar");
  reject.type = "button";
  reject.dataset.adminAction = "reject_avatar";
  reject.dataset.targetType = "user";
  reject.dataset.targetId = item.userId;
  actions.append(approve, reject);

  node.append(imageWrap, info, actions);
  return node;
}

function renderReportItem(report) {
  const node = el("article", "admin-panel__item");
  const info = el("div", "admin-panel__item-info");
  info.append(
    el("strong", "admin-panel__item-title", `${report.entityType}: ${report.entityId}`),
    el("span", "admin-panel__item-meta", report.reason || "Sin motivo")
  );
  node.append(info);
  return node;
}

function renderSection(title, count, children) {
  const section = el("section", "admin-panel__section");
  const header = el("div", "admin-panel__section-header");
  header.append(el("h3", "", title), el("span", "admin-panel__count", String(count)));
  const list = el("div", "admin-panel__list");
  children.forEach((child) => list.append(child));
  section.append(header, list);
  return section;
}

export function renderAdminPanel(state, dom) {
  const isOpen = Boolean(state.isAdminPanelOpen);
  const dashboard = state.adminDashboard || {};
  const pendingAvatars = Array.isArray(dashboard.pendingAvatars) ? dashboard.pendingAvatars : [];
  const reports = Array.isArray(dashboard.reports) ? dashboard.reports : [];

  if (dom.adminModalBackdrop) {
    dom.adminModalBackdrop.hidden = !isOpen;
  }

  if (dom.adminModal) {
    dom.adminModal.setAttribute("aria-hidden", String(!isOpen));
  }

  if (!dom.adminPanelBody) {
    return;
  }

  dom.adminPanelBody.textContent = "";
  if (!dashboard.loaded && isOpen) {
    dom.adminPanelBody.append(renderEmpty("Cargando moderacion..."));
    return;
  }

  dom.adminPanelBody.append(
    renderSection(
      "Fotos pendientes",
      pendingAvatars.length,
      pendingAvatars.length ? pendingAvatars.map(renderAvatarItem) : [renderEmpty("No hay fotos para revisar.")]
    ),
    renderSection(
      "Reportes abiertos",
      reports.length,
      reports.length ? reports.map(renderReportItem) : [renderEmpty("No hay reportes abiertos.")]
    )
  );
}