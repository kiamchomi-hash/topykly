export const REPORT_OTHER_REASON_VALUE = "other";

export const REPORT_REASONS = [
  { value: "spam", label: "Spam o publicidad" },
  { value: "harassment", label: "Acoso o intimidación" },
  { value: "hate", label: "Discurso de odio o discriminación" },
  { value: "violence", label: "Violencia o contenido perturbador" },
  { value: "sexual", label: "Contenido sexual inapropiado" },
  { value: REPORT_OTHER_REASON_VALUE, label: "Otro" }
];

export function composeReportReason(reasonValue, customText = "") {
  const trimmedCustomText = String(customText || "").trim();

  if (reasonValue === REPORT_OTHER_REASON_VALUE) {
    return trimmedCustomText;
  }

  const matched = REPORT_REASONS.find((reason) => reason.value === reasonValue);
  if (!matched) {
    return "";
  }

  return trimmedCustomText ? `${matched.label}: ${trimmedCustomText}` : matched.label;
}
