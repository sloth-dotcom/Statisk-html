import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatAmount(amount: string | null, currency: string | null): string {
  if (!amount) return "Ikke oplyst";
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency ?? ""}`.trim();
  return new Intl.NumberFormat("da-DK", {
    style: "currency",
    currency: currency ?? "DKK",
    maximumFractionDigits: 0,
  }).format(value);
}
