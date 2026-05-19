import "@tanstack/react-start/server-only";

export type ServerEnvInspection = {
  source: "process.env" | "import.meta.env" | "missing";
  rawLength: number;
  normalizedLength: number;
  hadOuterWhitespace: boolean;
  hadWrappingQuotes: boolean;
  value?: string;
};

function normalizeConfiguredValue(raw: string | undefined): Omit<ServerEnvInspection, "source"> {
  if (typeof raw !== "string") {
    return {
      rawLength: 0,
      normalizedLength: 0,
      hadOuterWhitespace: false,
      hadWrappingQuotes: false,
      value: undefined,
    };
  }

  const trimmed = raw.trim();
  const hadOuterWhitespace = trimmed !== raw;
  const hadWrappingQuotes =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")));
  const unwrapped = hadWrappingQuotes ? trimmed.slice(1, -1).trim() : trimmed;
  const value = unwrapped.length > 0 ? unwrapped : undefined;

  return {
    rawLength: raw.length,
    normalizedLength: value?.length ?? 0,
    hadOuterWhitespace,
    hadWrappingQuotes,
    value,
  };
}

export function inspectServerEnv(key: string): ServerEnvInspection {
  const processDetails = normalizeConfiguredValue(process.env[key]);
  if (processDetails.value) {
    return {
      source: "process.env",
      ...processDetails,
    };
  }

  const importMetaEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  const importMetaDetails = normalizeConfiguredValue(importMetaEnv?.[key]);
  if (importMetaDetails.value) {
    return {
      source: "import.meta.env",
      ...importMetaDetails,
    };
  }

  return {
    source: "missing",
    rawLength: 0,
    normalizedLength: 0,
    hadOuterWhitespace: false,
    hadWrappingQuotes: false,
    value: undefined,
  };
}

export function readServerEnv(key: string): string | undefined {
  return inspectServerEnv(key).value;
}
