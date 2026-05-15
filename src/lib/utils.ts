import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function isValidLocalKenyanPhone(value: string) {
  return /^0(1|7)\d{8}$/.test(phoneDigits(value));
}

export function toLocalKenyanPhone(value: string) {
  const digits = phoneDigits(value);
  if (/^254(1|7)\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  return digits;
}

export function toComparableKenyanPhone(value: string) {
  const digits = phoneDigits(value);
  if (/^0(1|7)\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^254(1|7)\d{8}$/.test(digits)) return digits;
  return digits;
}

export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
