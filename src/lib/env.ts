import { AppError } from "./errors";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new AppError("CONFIG_MISSING", `Missing environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function freeDraftLimit(): number {
  const n = Number(process.env.FREE_DRAFTS_PER_MONTH ?? "10");
  return Number.isFinite(n) && n >= 0 ? n : 10;
}
