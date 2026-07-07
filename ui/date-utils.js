const DEFAULT_LOCALE = "es-AR";
const JOINED_DATE_FALLBACK = "Fecha de registro no disponible";

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatMessageTime(timestamp, locale = DEFAULT_LOCALE) {
  const date = parseDate(timestamp);
  if (!date) {
    return "";
  }

  return date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatProfileJoinedDate(createdAt, locale = DEFAULT_LOCALE) {
  const date = parseDate(createdAt);
  if (!date) {
    return JOINED_DATE_FALLBACK;
  }

  return `Registro: ${date.toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric"
  })}`;
}

export function formatJoinedDateParts(createdAt) {
  const date = parseDate(createdAt);
  if (!date) {
    return [];
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return [day, month, String(date.getFullYear())];
}
