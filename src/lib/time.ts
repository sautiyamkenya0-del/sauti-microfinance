export const KENYA_TIME_ZONE = "Africa/Nairobi";

function partsForKenyaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KENYA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
}

export function todayInKenya(date = new Date()) {
  const parts = Object.fromEntries(partsForKenyaDate(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function timeInKenya(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: KENYA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatKenyaTime(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: KENYA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatKenyaDateTime(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: KENYA_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
