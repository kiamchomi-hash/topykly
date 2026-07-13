const DEFAULT_LOCALE = "es-AR";
const JOINED_DATE_FALLBACK = "Fecha de registro no disponible";
const MONTH_ABBREVIATIONS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameLocalDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatMessageTime(timestamp, locale = DEFAULT_LOCALE, now = new Date()) {
  const date = parseDate(timestamp);
  if (!date) {
    return "";
  }

  const referenceDate = parseDate(now) || new Date();
  if (!isSameLocalDay(date, referenceDate)) {
    return `${MONTH_ABBREVIATIONS[date.getMonth()]} ${date.getDate()}`;
  }

  return date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatProfileJoinedDate(createdAt) {
  const date = parseDate(createdAt);
  if (!date) {
    return JOINED_DATE_FALLBACK;
  }

  const [day, month, year] = formatJoinedDateParts(date);
  return `Registro: ${day}/${month}/${year.slice(-2)}`;
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

export const MINIMUM_REGISTRATION_AGE = 16;

export function computeAgeFromBirthdateParts(day, month, year) {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!d || !m || !y) {
    return null;
  }

  const birthDate = new Date(y, m - 1, d);
  if (birthDate.getFullYear() !== y || birthDate.getMonth() !== m - 1 || birthDate.getDate() !== d) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - y;
  const hadBirthdayThisYear =
    today.getMonth() > m - 1 || (today.getMonth() === m - 1 && today.getDate() >= d);
  if (!hadBirthdayThisYear) {
    age -= 1;
  }
  return age;
}

export function populateBirthYearOptions(select, minimumAge = MINIMUM_REGISTRATION_AGE, maxYearsBack = 120) {
  if (!select || typeof select.appendChild !== "function" || (select.options?.length || 0) > 1) {
    return;
  }

  const currentYear = new Date().getFullYear();
  const maxYear = currentYear - minimumAge;
  const minYear = currentYear - maxYearsBack;
  for (let year = maxYear; year >= minYear; year -= 1) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    select.appendChild(option);
  }
}
