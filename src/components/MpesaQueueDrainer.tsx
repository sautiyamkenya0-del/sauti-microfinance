import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { toast } from "sonner";

/** Low-frequency fallback that retries any unprocessed M-Pesa confirmations. */
export function MpesaQueueDrainer() {
  const { applyMpesaPayment } = useStore();

  useEffect(() => {
    let stop = false;

    async function tick() {
      if (document.hidden || stop) return;
      try {
        const r = await fetch("/api/mpesa/queue", {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        });
        if (!r.ok) return;
        const { items } = await r.json();
        if (!Array.isArray(items) || items.length === 0) return;
        for (const it of items as Array<{
          id: string;
          txId: string;
          amount: number;
          account: string;
          name: string;
        }>) {
          const res = await applyMpesaPayment(it.account, it.amount, it.name, it.txId, it.id);
          (res.matched ? toast.success : toast.warning)(
            `M-Pesa ${it.txId}: ${res.notes.join(" ")}`,
          );
        }
      } catch {
        // Confirmation callbacks already try immediate processing; this queue drainer is only a low-frequency safety net.
      }
    }

    void tick();
    const onVisible = () => {
      if (!document.hidden && !stop) void tick();
    };
    const id = setInterval(() => {
      if (!stop) void tick();
    }, 60000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [applyMpesaPayment]);
  return null;
}
