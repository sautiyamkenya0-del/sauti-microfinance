export function readServerEnv(key: string): string | undefined {
  const processValue = process.env[key];
  if (typeof processValue === "string" && processValue.length > 0) return processValue;

  const importMetaEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  const importMetaValue = importMetaEnv?.[key];
  if (typeof importMetaValue === "string" && importMetaValue.length > 0) {
    return importMetaValue;
  }

  return undefined;
}
