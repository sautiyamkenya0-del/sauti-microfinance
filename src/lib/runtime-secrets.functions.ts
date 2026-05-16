import { createServerFn } from "@tanstack/react-start";

import {
  deleteRuntimeSecretOnServer,
  listRuntimeSecretsFromServer,
  saveRuntimeSecretOnServer,
} from "@/lib/runtime-secrets.server";

type RuntimeSecretListResult = {
  items: Array<{ key: string; preview: string; length: number; updated_at: string }>;
  writable: boolean;
  reason: string;
};

/** List all runtime secret keys with redacted previews. */
export const listRuntimeSecrets = createServerFn({ method: "GET" }).handler<
  Promise<RuntimeSecretListResult>
>(async () => listRuntimeSecretsFromServer());

/** Upsert a runtime secret. */
export const setRuntimeSecret = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      key: string;
      value: string;
      actorId?: string;
      actorName?: string;
      actorRole?: string;
    }) => {
      const key = String(data?.key ?? "")
        .trim()
        .toUpperCase();
      const value = String(data?.value ?? "");
      if (!/^[A-Z0-9_]{2,64}$/.test(key)) throw new Error("Key must be A-Z, 0-9, _ (2-64 chars)");
      if (!value || value.length > 4096) throw new Error("Value required (max 4096 chars)");
      return {
        key,
        value,
        actorId: data.actorId,
        actorName: data.actorName,
        actorRole: data.actorRole,
      };
    },
  )
  .handler(async ({ data }) => {
    await saveRuntimeSecretOnServer(data.key, data.value, {
      actorId: data.actorId,
      actorName: data.actorName,
      actorRole: data.actorRole,
    });

    return { ok: true };
  });

/** Delete a secret. */
export const deleteRuntimeSecret = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { key: string; actorId?: string; actorName?: string; actorRole?: string }) => ({
      key: String(data?.key ?? "")
        .trim()
        .toUpperCase(),
      actorId: data.actorId,
      actorName: data.actorName,
      actorRole: data.actorRole,
    }),
  )
  .handler(async ({ data }) => {
    await deleteRuntimeSecretOnServer(data.key, {
      actorId: data.actorId,
      actorName: data.actorName,
      actorRole: data.actorRole,
    });

    return { ok: true };
  });
