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
  image.width = 64;
  image.height = 64;
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

function createAdminActionButton(label, actionType, targetType, targetId, isConfirming) {
  const button = el(
    "button",
    `text-button admin-panel__action${isConfirming ? " is-confirming" : ""}`,
    isConfirming ? "¿Confirmar?" : label
  );
  button.type = "button";
  button.dataset.adminAction = actionType;
  button.dataset.targetType = targetType;
  button.dataset.targetId = targetId;
  return button;
}

function renderReportItem(report, adminConfirmAction) {
  const node = el("article", "admin-panel__item admin-panel__item--report");
  const info = el("div", "admin-panel__item-info");
  const target = report.target;

  let title;
  let subtitle;
  if (report.entityType === "message" && target) {
    title = target.text || "Comentario eliminado";
    subtitle = `De ${target.authorName} en "${target.topicTitle}"`;
  } else if (report.entityType === "topic" && target) {
    title = target.title;
    subtitle = `Tema de ${target.authorName}`;
  } else if (report.entityType === "user" && target) {
    title = target.name;
    subtitle = target.status === "expelled" ? "Usuario (ya sancionado)" : "Usuario";
  } else {
    title = `${report.entityType}: ${report.entityId}`;
    subtitle = "Contenido no disponible";
  }

  info.append(
    el("strong", "admin-panel__item-title", title),
    el("span", "admin-panel__item-meta", subtitle),
    el("span", "admin-panel__item-meta", `Motivo: ${report.reason || "Sin motivo"} - reportado por ${report.reporterName}`)
  );
  node.append(info);

  if (report.entityType === "message" && target) {
    const actions = el("div", "admin-panel__item-actions");
    const deleteKey = `delete_message:message:${report.entityId}`;
    const sanctionKey = `expel_user:user:${target.authorId}`;
    actions.append(
      createAdminActionButton(
        "Eliminar comentario",
        "delete_message",
        "message",
        report.entityId,
        adminConfirmAction?.key === deleteKey
      ),
      createAdminActionButton(
        "Sancionar usuario",
        "expel_user",
        "user",
        target.authorId,
        adminConfirmAction?.key === sanctionKey
      )
    );
    node.append(actions);
  }

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

function syncAdminButton(state, dom) {
  const button = dom.adminPanelButton;
  if (!button) {
    return;
  }

  const count = state.pendingModerationCount || 0;
  button.setAttribute("aria-expanded", String(Boolean(state.isAdminPanelOpen)));
  if (count > 0) {
    button.dataset.pendingModeration = count > 99 ? "99+" : String(count);
    button.setAttribute("title", `Administración (${count} pendientes)`);
  } else {
    delete button.dataset.pendingModeration;
    button.setAttribute("title", "Administración");
  }
}

export function renderAdminPanel(state, dom) {
  syncAdminButton(state, dom);

  const isOpen = Boolean(state.isAdminPanelOpen);
  const dashboard = state.adminDashboard || {};
  const pendingAvatars = Array.isArray(dashboard.pendingAvatars) ? dashboard.pendingAvatars : [];
  const reports = Array.isArray(dashboard.reports) ? dashboard.reports : [];
  const avatarCount = Number.isFinite(dashboard.avatarPagination?.total)
    ? dashboard.avatarPagination.total
    : pendingAvatars.length;
  const reportCount = Number.isFinite(dashboard.reportPagination?.total)
    ? dashboard.reportPagination.total
    : reports.length;

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
    dom.adminPanelBody.append(renderEmpty("Cargando moderación..."));
    return;
  }

  dom.adminPanelBody.append(
    renderSection(
      "Fotos pendientes",
      avatarCount,
      pendingAvatars.length ? pendingAvatars.map(renderAvatarItem) : [renderEmpty("No hay fotos para revisar.")]
    ),
    renderSection(
      "Reportes abiertos",
      reportCount,
      reports.length
        ? reports.map((report) => renderReportItem(report, state.adminConfirmAction))
        : [renderEmpty("No hay reportes abiertos.")]
    )
  );
}