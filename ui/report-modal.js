import { REPORT_REASONS } from "../report-reasons.js";

const ENTITY_TITLES = {
  message: "Reportar mensaje",
  topic: "Reportar tema",
  user: "Reportar usuario"
};

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

function buildReasonOptions(container) {
  if (!container || container.dataset.built === "true") {
    return;
  }

  REPORT_REASONS.forEach((reason) => {
    const optionId = `reportReason-${reason.value}`;
    const option = el("label", "report-modal__reason-option");
    option.setAttribute("for", optionId);

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "reportReason";
    input.id = optionId;
    input.value = reason.value;

    option.append(input, el("span", "report-modal__reason-label", reason.label));
    container.append(option);
  });

  container.dataset.built = "true";
}

function resetReportForm(dom) {
  dom.reportReasonForm?.reset?.();
  if (dom.reportModalSubmitButton) {
    dom.reportModalSubmitButton.disabled = true;
  }
}

export function renderReportModal(state, dom) {
  buildReasonOptions(dom.reportReasonOptions);

  const reportModal = state.reportModal || {};
  const isOpen = Boolean(reportModal.isOpen);
  const entityType = reportModal.entityType;

  if (dom.reportModalBackdrop) {
    dom.reportModalBackdrop.hidden = !isOpen;
  }

  if (dom.reportModal) {
    dom.reportModal.setAttribute("aria-hidden", String(!isOpen));
  }

  if (dom.reportModalTitle) {
    dom.reportModalTitle.textContent = ENTITY_TITLES[entityType] || "Reportar";
  }

  if (!dom.reportReasonForm) {
    return;
  }

  const openKey = isOpen ? `${entityType}:${reportModal.entityId}` : "";
  if (dom.reportReasonForm.dataset.openKey === openKey) {
    return;
  }

  dom.reportReasonForm.dataset.openKey = openKey;
  resetReportForm(dom);
}
