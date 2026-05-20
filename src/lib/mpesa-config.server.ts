import "@tanstack/react-start/server-only";

import {
  inspectSecret,
  type SecretInspection,
  type SecretResolutionMode,
  type SecretValueInspection,
} from "@/lib/runtime-secrets.server";
import { readServerEnv } from "@/lib/server-env";

export type MpesaConfigVariant = {
  label: "effective" | "hosting_env" | "runtime_vault";
  resolutionMode: SecretResolutionMode;
  env?: string;
  normalizedEnv: "sandbox" | "production";
  consumerKey?: string;
  consumerSecret?: string;
  shortcode?: string;
  passkey?: string;
  callbackUrl?: string;
  smsUrl?: string;
  smsUsername?: string;
  smsPassword?: string;
  smsSource?: string;
  smsFallbackPhone?: string;
  completeness: {
    oauthReady: boolean;
    stkReady: boolean;
  };
  sources: {
    MPESA_ENV: SecretValueInspection["source"];
    MPESA_CONSUMER_KEY: SecretValueInspection["source"];
    MPESA_CONSUMER_SECRET: SecretValueInspection["source"];
    MPESA_SHORTCODE: SecretValueInspection["source"];
    MPESA_PASSKEY: SecretValueInspection["source"];
    MPESA_CALLBACK_URL: SecretValueInspection["source"];
    MPESA_SMS_URL: SecretValueInspection["source"];
    MPESA_SMS_USERNAME: SecretValueInspection["source"];
    MPESA_SMS_PASSWORD: SecretValueInspection["source"];
    MPESA_SMS_SOURCE: SecretValueInspection["source"];
    MPESA_SMS_FALLBACK_PHONE: SecretValueInspection["source"];
  };
};

export type DarajaTokenAttempt = {
  label: MpesaConfigVariant["label"];
  normalizedEnv: MpesaConfigVariant["normalizedEnv"];
  url: string;
  sourceSummary: {
    consumerKey: SecretValueInspection["source"];
    consumerSecret: SecretValueInspection["source"];
    shortcode: SecretValueInspection["source"];
    passkey: SecretValueInspection["source"];
  };
  ok: boolean;
  status?: number;
  timeoutMs?: number;
  body?: unknown;
  error?: string;
};

export class MpesaRequestTimeoutError extends Error {
  timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Daraja request timed out after ${timeoutMs}ms.`);
    this.name = "MpesaRequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

function normalizeMpesaEnv(value?: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase() === "sandbox"
    ? "sandbox"
    : "production";
}

function toTimeout(value: string | undefined, fallback: number) {
  const next = Number(value ?? fallback);
  return Number.isFinite(next) && next >= 1000 ? Math.floor(next) : fallback;
}

export function mpesaDarajaTimeoutMs() {
  return toTimeout(readServerEnv("MPESA_DARAJA_TIMEOUT_MS"), 8000);
}

export async function fetchMpesaDaraja(input: string, init: RequestInit = {}) {
  const timeoutMs = mpesaDarajaTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    const errorName =
      error && typeof error === "object" && "name" in error
        ? String((error as { name?: unknown }).name ?? "")
        : "";
    if (errorName === "AbortError") {
      throw new MpesaRequestTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function mpesaBaseUrl(env?: string) {
  return normalizeMpesaEnv(env) === "sandbox"
    ? "https://sandbox.safaricom.co.ke"
    : "https://api.safaricom.co.ke";
}

function pickCandidateValue(details: SecretInspection, label: MpesaConfigVariant["label"]) {
  if (label === "runtime_vault") return details.candidates.runtimeVault;
  if (label === "hosting_env") return details.candidates.hostingEnv;
  return {
    source: details.source,
    rawLength: details.rawLength,
    normalizedLength: details.normalizedLength,
    hadOuterWhitespace: details.hadOuterWhitespace,
    hadWrappingQuotes: details.hadWrappingQuotes,
    value: details.value,
  };
}

function buildVariantFromSecrets(args: {
  label: MpesaConfigVariant["label"];
  resolutionMode: SecretResolutionMode;
  env: SecretInspection;
  consumerKey: SecretInspection;
  consumerSecret: SecretInspection;
  shortcode: SecretInspection;
  passkey: SecretInspection;
  callbackUrl: SecretInspection;
  smsUrl: SecretInspection;
  smsUsername: SecretInspection;
  smsPassword: SecretInspection;
  smsSource: SecretInspection;
  smsFallbackPhone: SecretInspection;
}) {
  const envDetails = pickCandidateValue(args.env, args.label);
  const consumerKeyDetails = pickCandidateValue(args.consumerKey, args.label);
  const consumerSecretDetails = pickCandidateValue(args.consumerSecret, args.label);
  const shortcodeDetails = pickCandidateValue(args.shortcode, args.label);
  const passkeyDetails = pickCandidateValue(args.passkey, args.label);
  const callbackUrlDetails = pickCandidateValue(args.callbackUrl, args.label);
  const smsUrlDetails = pickCandidateValue(args.smsUrl, args.label);
  const smsUsernameDetails = pickCandidateValue(args.smsUsername, args.label);
  const smsPasswordDetails = pickCandidateValue(args.smsPassword, args.label);
  const smsSourceDetails = pickCandidateValue(args.smsSource, args.label);
  const smsFallbackPhoneDetails = pickCandidateValue(args.smsFallbackPhone, args.label);

  const normalizedEnv = normalizeMpesaEnv(envDetails.value);
  const pubBase = String(readServerEnv("PUBLIC_BASE_URL") ?? "").trim();
  const callbackFallback = pubBase ? `${pubBase.replace(/\/+$/, "")}/api/public/mpesa/confirmation` : "";
  const callbackUrlValue = (String(callbackUrlDetails.value ?? "").trim() || callbackFallback) || undefined;

  const variant: MpesaConfigVariant = {
    label: args.label,
    resolutionMode: args.resolutionMode,
    env: envDetails.value,
    normalizedEnv,
    consumerKey: consumerKeyDetails.value,
    consumerSecret: consumerSecretDetails.value,
    shortcode: shortcodeDetails.value,
    passkey: passkeyDetails.value,
    callbackUrl: callbackUrlValue,
    smsUrl: smsUrlDetails.value,
    smsUsername: smsUsernameDetails.value,
    smsPassword: smsPasswordDetails.value,
    smsSource: smsSourceDetails.value,
    smsFallbackPhone: smsFallbackPhoneDetails.value,
    completeness: {
      oauthReady: !!consumerKeyDetails.value && !!consumerSecretDetails.value,
      stkReady:
        !!consumerKeyDetails.value &&
        !!consumerSecretDetails.value &&
        !!shortcodeDetails.value &&
        !!passkeyDetails.value,
    },
    sources: {
      MPESA_ENV: envDetails.source,
      MPESA_CONSUMER_KEY: consumerKeyDetails.source,
      MPESA_CONSUMER_SECRET: consumerSecretDetails.source,
      MPESA_SHORTCODE: shortcodeDetails.source,
      MPESA_PASSKEY: passkeyDetails.source,
      MPESA_CALLBACK_URL: callbackUrlDetails.source,
      MPESA_SMS_URL: smsUrlDetails.source,
      MPESA_SMS_USERNAME: smsUsernameDetails.source,
      MPESA_SMS_PASSWORD: smsPasswordDetails.source,
      MPESA_SMS_SOURCE: smsSourceDetails.source,
      MPESA_SMS_FALLBACK_PHONE: smsFallbackPhoneDetails.source,
    },
  };
  return variant;
}

function variantFingerprint(config: MpesaConfigVariant) {
  return JSON.stringify({
    env: config.env ?? "",
    consumerKey: config.consumerKey ?? "",
    consumerSecret: config.consumerSecret ?? "",
    shortcode: config.shortcode ?? "",
    passkey: config.passkey ?? "",
    callbackUrl: config.callbackUrl ?? "",
  });
}

export function getMpesaConfigCandidateOrder(
  variants: Awaited<ReturnType<typeof loadMpesaConfigVariants>>,
) {
  const orderedCandidates: MpesaConfigVariant[] = [variants.effective];
  if (variants.resolutionMode === "runtime-first" || variants.resolutionMode === "env-first") {
    for (const variant of [variants.hostingEnv, variants.runtimeVault]) {
      if (
        variant.completeness.oauthReady &&
        !orderedCandidates.some(
          (existing) => variantFingerprint(existing) === variantFingerprint(variant),
        )
      ) {
        orderedCandidates.push(variant);
      }
    }
  }
  return orderedCandidates;
}

async function fetchDarajaToken(
  config: MpesaConfigVariant,
): Promise<DarajaTokenAttempt & { accessToken?: string; expiresIn?: unknown }> {
  const url = `${mpesaBaseUrl(config.env)}/oauth/v1/generate?grant_type=client_credentials`;
  const attempt: DarajaTokenAttempt = {
    label: config.label,
    normalizedEnv: config.normalizedEnv,
    url,
    sourceSummary: {
      consumerKey: config.sources.MPESA_CONSUMER_KEY,
      consumerSecret: config.sources.MPESA_CONSUMER_SECRET,
      shortcode: config.sources.MPESA_SHORTCODE,
      passkey: config.sources.MPESA_PASSKEY,
    },
    ok: false,
  };

  if (!config.completeness.oauthReady) {
    return {
      ...attempt,
      error: "Consumer key/secret are not fully configured for this source.",
    };
  }

  try {
    const auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64");
    const res = await fetchMpesaDaraja(url, {
      headers: { Authorization: `Basic ${auth}` },
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!res.ok) {
      return {
        ...attempt,
        status: res.status,
        body,
        error: typeof body === "string" ? body : undefined,
      };
    }
    const json = (typeof body === "object" && body ? body : {}) as Record<string, unknown>;
    return {
      ...attempt,
      ok: true,
      status: res.status,
      body,
      accessToken: String(json.access_token ?? "").trim() || undefined,
      expiresIn: json.expires_in,
    };
  } catch (error) {
    if (error instanceof MpesaRequestTimeoutError) {
      return {
        ...attempt,
        timeoutMs: error.timeoutMs,
        error: error.message,
      };
    }
    return {
      ...attempt,
      error: error instanceof Error ? error.message : "fetch failed",
    };
  }
}

export async function getDarajaAccessTokenForConfig(config: MpesaConfigVariant) {
  return fetchDarajaToken(config);
}

export async function loadMpesaConfigVariants() {
  const [
    envDetails,
    consumerKeyDetails,
    consumerSecretDetails,
    shortcodeDetails,
    passkeyDetails,
    callbackUrlDetails,
    smsUrlDetails,
    smsUsernameDetails,
    smsPasswordDetails,
    smsSourceDetails,
    smsFallbackPhoneDetails,
  ] = await Promise.all([
    inspectSecret("MPESA_ENV"),
    inspectSecret("MPESA_CONSUMER_KEY"),
    inspectSecret("MPESA_CONSUMER_SECRET"),
    inspectSecret("MPESA_SHORTCODE"),
    inspectSecret("MPESA_PASSKEY"),
    inspectSecret("MPESA_CALLBACK_URL"),
    inspectSecret("MPESA_SMS_URL"),
    inspectSecret("MPESA_SMS_USERNAME"),
    inspectSecret("MPESA_SMS_PASSWORD"),
    inspectSecret("MPESA_SMS_SOURCE"),
    inspectSecret("MPESA_SMS_FALLBACK_PHONE"),
  ]);

  const resolutionMode = consumerKeyDetails.resolutionMode;
  const inputs = {
    resolutionMode,
    env: envDetails,
    consumerKey: consumerKeyDetails,
    consumerSecret: consumerSecretDetails,
    shortcode: shortcodeDetails,
    passkey: passkeyDetails,
    callbackUrl: callbackUrlDetails,
    smsUrl: smsUrlDetails,
    smsUsername: smsUsernameDetails,
    smsPassword: smsPasswordDetails,
    smsSource: smsSourceDetails,
    smsFallbackPhone: smsFallbackPhoneDetails,
  };

  const effective = buildVariantFromSecrets({ label: "effective", ...inputs });
  const hostingEnv = buildVariantFromSecrets({ label: "hosting_env", ...inputs });
  const runtimeVault = buildVariantFromSecrets({ label: "runtime_vault", ...inputs });

  return {
    resolutionMode,
    effective,
    hostingEnv,
    runtimeVault,
  };
}

export async function getDarajaAccessToken() {
  const variants = await loadMpesaConfigVariants();
  const orderedCandidates = getMpesaConfigCandidateOrder(variants);

  const attempts: DarajaTokenAttempt[] = [];
  for (const variant of orderedCandidates) {
    const result = await fetchDarajaToken(variant);
    attempts.push(result);
    if (result.ok && result.accessToken) {
      return {
        ok: true as const,
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        config: variant,
        attempts,
        variants,
      };
    }
  }

  const lastAttempt = attempts[attempts.length - 1];
  return {
    ok: false as const,
    status: lastAttempt?.status,
    error: lastAttempt?.error ?? "M-Pesa authentication failed.",
    attempts,
    variants,
  };
}

export async function listConfiguredMpesaShortcodes() {
  const variants = await loadMpesaConfigVariants();
  return Array.from(
    new Set(
      [variants.effective.shortcode, variants.hostingEnv.shortcode, variants.runtimeVault.shortcode]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
}
