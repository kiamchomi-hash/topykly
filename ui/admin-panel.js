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
const ANALYTICS_EVENT_LABELS = {
  page_view: "Visitas",
  return_visit: "Regresos",
  topic_open: "Conversaciones abiertas",
  auth_open: "Accesos iniciados",
  registration_complete: "Registros",
  login_complete: "Sesiones iniciadas",
  publish_attempt: "Intentos de publicación",
  topic_created: "Temas creados",
  comment_created: "Comentarios creados"
};
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

function createAdminActionButton(
  label,
  actionType,
  targetType,
  targetId,
  isConfirming,
  tone = "neutral"
) {
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
      subtitle:
        target.status === "expelled" ? "Usuario con sancion permanente" : "Perfil de usuario",
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
  const isConfirming = (actionType, targetType, targetId) =>
    adminConfirmAction?.key === actionKey(actionType, targetType, targetId);

  if (report.entityType === "message" && report.target) {
    actions.append(
      createAdminActionButton(
        "Eliminar comentario",
        "delete_message",
        "message",
        report.entityId,
        isConfirming("delete_message", "message", report.entityId),
        "danger"
      )
    );
  }
  if (report.entityType === "topic" && report.target) {
    actions.append(
      createAdminActionButton(
        "Bloquear tema",
        "block_topic",
        "topic",
        report.entityId,
        isConfirming("block_topic", "topic", report.entityId),
        "danger"
      )
    );
  }
  if (content.authorId && !content.sanction?.active) {
    const nextLabel = content.sanction?.nextLabel || "24 horas";
    actions.append(
      createAdminActionButton(
        `Sancion progresiva · ${nextLabel}`,
        "expel_user",
        "user",
        content.authorId,
        isConfirming("expel_user", "user", content.authorId),
        "warning"
      )
    );
  }
  actions.append(
    createAdminActionButton(
      "Descartar reporte",
      "dismiss_report",
      report.entityType,
      report.entityId,
      false
    )
  );

  node.append(info, actions);
  return node;
}

function renderSanctionItem(item, adminConfirmAction) {
  const node = el("article", "admin-panel__item admin-panel__item--sanction");
  const info = el("div", "admin-panel__item-info");
  const until =
    item.kind === "permanent"
      ? "Sin fecha de finalizacion"
      : `Finaliza ${formatAdminDate(item.bannedUntil)}`;
  info.append(
    el(
      "span",
      "admin-panel__eyebrow",
      item.kind === "permanent" ? "Sancion permanente" : "Suspension activa"
    ),
    el("strong", "admin-panel__item-title", item.name || item.userId),
    el("span", "admin-panel__item-meta", `${item.label} · ${until}`),
    el("p", "admin-panel__reason", item.reason || "Sin motivo detallado")
  );

  const key = `restore_user:user:${item.userId}`;
  const actions = el("div", "admin-panel__item-actions");
  actions.append(
    createAdminActionButton(
      "Anular sancion",
      "restore_user",
      "user",
      item.userId,
      adminConfirmAction?.key === key,
      "danger"
    )
  );
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

function getAnalyticsEvent(analytics, eventName) {
  return (
    (analytics?.events || []).find((event) => event.eventName === eventName) || {
      eventName,
      total: 0,
      uniqueSubjects: 0
    }
  );
}

function formatConversion(numerator, denominator) {
  if (!denominator) {
    return "Sin base suficiente";
  }
  return `${Math.round((numerator / denominator) * 100)}% de conversión`;
}

function renderAnalyticsMetric(label, value, detail) {
  const card = el("article", "admin-panel__metric");
  card.append(
    el("span", "admin-panel__metric-label", label),
    el("strong", "admin-panel__metric-value", String(value)),
    el("span", "admin-panel__metric-detail", detail)
  );
  return card;
}

function renderAnalyticsDashboard(analytics) {
  const section = el("section", "admin-panel__analytics");
  const pageViews = getAnalyticsEvent(analytics, "page_view");
  const topicOpens = getAnalyticsEvent(analytics, "topic_open");
  const authOpens = getAnalyticsEvent(analytics, "auth_open");
  const registrations = getAnalyticsEvent(analytics, "registration_complete");
  const publishAttempts = getAnalyticsEvent(analytics, "publish_attempt");
  const topicsCreated = getAnalyticsEvent(analytics, "topic_created");
  const commentsCreated = getAnalyticsEvent(analytics, "comment_created");
  const returnVisits = getAnalyticsEvent(analytics, "return_visit");

  const header = el("div", "admin-panel__analytics-header");
  const headerCopy = el("div");
  headerCopy.append(
    el("h3", "", "Embudo del producto"),
    el("p", "", "Datos seudónimos y agregados, sin contenido de mensajes ni direcciones IP.")
  );
  header.append(
    headerCopy,
    el("span", "admin-panel__analytics-period", `Últimos ${analytics?.days || 30} días`)
  );

  const metrics = el("div", "admin-panel__metrics");
  metrics.append(
    renderAnalyticsMetric(
      "Personas visitantes",
      pageViews.uniqueSubjects,
      `${pageViews.total} vistas registradas`
    ),
    renderAnalyticsMetric(
      "Conversaciones abiertas",
      topicOpens.uniqueSubjects,
      formatConversion(topicOpens.uniqueSubjects, pageViews.uniqueSubjects)
    ),
    renderAnalyticsMetric(
      "Registros completados",
      registrations.uniqueSubjects,
      formatConversion(registrations.uniqueSubjects, authOpens.uniqueSubjects)
    ),
    renderAnalyticsMetric(
      "Publicaciones",
      topicsCreated.total + commentsCreated.total,
      formatConversion(topicsCreated.total + commentsCreated.total, publishAttempts.total)
    ),
    renderAnalyticsMetric(
      "Regresos",
      returnVisits.uniqueSubjects,
      formatConversion(returnVisits.uniqueSubjects, pageViews.uniqueSubjects)
    )
  );

  const eventList = el("div", "admin-panel__analytics-events");
  (analytics?.events || []).forEach((event) => {
    const row = el("div", "admin-panel__analytics-event");
    row.append(
      el("span", "", ANALYTICS_EVENT_LABELS[event.eventName] || event.eventName),
      el("strong", "", String(event.total)),
      el("small", "", `${event.uniqueSubjects} personas`)
    );
    eventList.append(row);
  });

  const sourceLabels = {
    direct: "Directo",
    internal: "Navegación interna",
    search: "Buscadores",
    social: "Redes sociales",
    email: "Correo",
    campaign: "Campañas",
    referral: "Referencias"
  };
  const sourceList = el("div", "admin-panel__analytics-events");
  (analytics?.sources || []).forEach((source) => {
    const row = el("div", "admin-panel__analytics-event");
    row.append(
      el("span", "", sourceLabels[source.sourceGroup] || source.sourceGroup),
      el("strong", "", String(source.total)),
      el("small", "", `${source.uniqueSubjects} personas`)
    );
    sourceList.append(row);
  });
  if (!sourceList.childElementCount) {
    sourceList.append(renderEmpty("Aún no hay fuentes de adquisición registradas."));
  }

  const routeList = el("div", "admin-panel__analytics-events");
  (analytics?.routes || []).forEach((route) => {
    const row = el("div", "admin-panel__analytics-event");
    row.append(
      el("span", "", route.routeGroup),
      el("strong", "", String(route.total)),
      el("small", "", `${route.uniqueSubjects} personas`)
    );
    routeList.append(row);
  });
  if (!routeList.childElementCount) {
    routeList.append(renderEmpty("Aún no hay páginas de entrada registradas."));
  }

  const cohortList = el("div", "admin-panel__analytics-events");
  (analytics?.cohorts || []).slice(-7).forEach((cohort) => {
    const row = el("div", "admin-panel__analytics-event");
    row.append(
      el("span", "", cohort.cohortDay),
      el("strong", "", formatConversion(cohort.returnedVisitors, cohort.visitors)),
      el("small", "", `${cohort.returnedVisitors}/${cohort.visitors} regresaron`)
    );
    cohortList.append(row);
  });
  if (!cohortList.childElementCount) {
    cohortList.append(renderEmpty("Aún no hay cohortes suficientes para calcular regresos."));
  }

  const retentionSourceList = el("div", "admin-panel__analytics-events");
  (analytics?.retentionBySource || []).forEach((entry) => {
    const row = el("div", "admin-panel__analytics-event");
    row.append(
      el("span", "", sourceLabels[entry.sourceGroup] || entry.sourceGroup),
      el("strong", "", formatConversion(entry.returnedVisitors, entry.visitors)),
      el("small", "", `${entry.returnedVisitors}/${entry.visitors} regresaron`)
    );
    retentionSourceList.append(row);
  });
  if (!retentionSourceList.childElementCount) {
    retentionSourceList.append(renderEmpty("Aún no hay datos de regreso por fuente."));
  }

  const dailyTotals = new Map();
  (analytics?.daily || []).forEach((entry) => {
    dailyTotals.set(entry.day, (dailyTotals.get(entry.day) || 0) + entry.total);
  });
  const recentDays = [...dailyTotals.entries()].slice(-7);
  const maximumDailyTotal = Math.max(1, ...recentDays.map(([, total]) => total));
  const dailyChart = el("div", "admin-panel__analytics-chart");
  dailyChart.setAttribute("aria-label", "Actividad diaria de los últimos siete días");
  recentDays.forEach(([day, total]) => {
    const row = el("div", "admin-panel__analytics-day");
    const bar = el("span", "admin-panel__analytics-bar");
    bar.style.setProperty(
      "--analytics-width",
      `${Math.max(4, Math.round((total / maximumDailyTotal) * 100))}%`
    );
    row.append(
      el(
        "time",
        "",
        new Intl.DateTimeFormat("es", { day: "2-digit", month: "short" }).format(
          new Date(`${day}T12:00:00Z`)
        )
      ),
      bar,
      el("strong", "", String(total))
    );
    dailyChart.append(row);
  });
  if (!recentDays.length) {
    dailyChart.append(
      renderEmpty("Aún no hay actividad suficiente para mostrar la evolución diaria.")
    );
  }

  section.append(
    header,
    metrics,
    el("h4", "admin-panel__analytics-subtitle", "Eventos registrados"),
    eventList,
    el("h4", "admin-panel__analytics-subtitle", "Adquisición"),
    sourceList,
    el("h4", "admin-panel__analytics-subtitle", "Páginas de entrada"),
    routeList,
    el("h4", "admin-panel__analytics-subtitle", "Regreso por cohorte"),
    cohortList,
    el("h4", "admin-panel__analytics-subtitle", "Regreso por fuente"),
    retentionSourceList,
    el("h4", "admin-panel__analytics-subtitle", "Actividad reciente"),
    dailyChart
  );
  return section;
}

function createAdminNavigation(activeSection, counts) {
  const nav = el("nav", "admin-panel__nav");
  nav.setAttribute("aria-label", "Tipos de moderacion");
  [
    { id: "analytics", label: "Métricas", count: counts.analytics },
    { id: "reports", label: "Reportes", count: counts.reports },
    { id: "avatars", label: "Fotos", count: counts.avatars },
    { id: "sanctions", label: "Sanciones", count: counts.sanctions }
  ].forEach((item) => {
    const button = el(
      "button",
      `admin-panel__nav-button${activeSection === item.id ? " is-active" : ""}`
    );
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
  const productAnalytics = dashboard.productAnalytics || null;
  const avatarCount = Number.isFinite(dashboard.avatarPagination?.total)
    ? dashboard.avatarPagination.total
    : pendingAvatars.length;
  const reportCount = Number.isFinite(dashboard.reportPagination?.total)
    ? dashboard.reportPagination.total
    : reports.length;
  const activeSection = ["analytics", "reports", "avatars", "sanctions"].includes(
    state.adminSection
  )
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
  dom.adminPanelBody.append(
    createAdminNavigation(activeSection, {
      analytics: getAnalyticsEvent(productAnalytics, "page_view").total,
      reports: reportCount,
      avatars: avatarCount,
      sanctions: activeSanctions.length
    })
  );

  const workspace = el("div", "admin-panel__workspace");
  if (!dashboard.loaded && isOpen) {
    workspace.append(renderEmpty("Cargando la cola de moderacion..."));
    dom.adminPanelBody.append(workspace);
    return;
  }

  if (activeSection === "analytics") {
    workspace.append(renderAnalyticsDashboard(productAnalytics));
  } else if (activeSection === "avatars") {
    workspace.append(
      renderSection(
        "Fotos de perfil",
        avatarCount,
        pendingAvatars.length
          ? pendingAvatars.map(renderAvatarItem)
          : [renderEmpty("No hay fotos para revisar.")],
        "Aprueba o rechaza imagenes antes de que aparezcan publicamente."
      )
    );
  } else if (activeSection === "sanctions") {
    workspace.append(
      renderSection(
        "Sanciones activas",
        activeSanctions.length,
        activeSanctions.length
          ? activeSanctions.map((item) => renderSanctionItem(item, state.adminConfirmAction))
          : [renderEmpty("No hay usuarios con sanciones activas.")],
        "Puedes anular una suspension o expulsion que se haya aplicado por error."
      )
    );
  } else {
    REPORT_GROUPS.forEach((group) => {
      const items = reports.filter((report) => report.entityType === group.type);
      workspace.append(
        renderSection(
          group.title,
          items.length,
          items.length
            ? items.map((report) => renderReportItem(report, state.adminConfirmAction))
            : [renderEmpty(group.empty)]
        )
      );
    });
  }

  dom.adminPanelBody.append(workspace);
}
