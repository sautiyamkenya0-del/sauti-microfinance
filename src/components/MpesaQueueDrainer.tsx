import { useEffect } from "react";
import { toast } from "sonner";

/** Low-frequency fallback that retries any unprocessed M-Pesa confirmations. */
export function MpesaQueueDrainer() {
  useEffect(() => {
    let stop = false;

    async function tick() {
      if (document.hidden || stop) return;
      try {
        let totalProcessed = 0;
        let totalMatched = 0;
        let totalFailed = 0;

        for (let batch = 0; batch < 8 && !stop; batch += 1) {
          const r = await fetch("/api/mpesa/queue", {
            method: "POST",
            cache: "no-store",
            headers: {
              "Cache-Control": "no-cache",
              Pragma: "no-cache",
            },
          });
          if (!r.ok) break;
          const { items, processed } = await r.json();
          if (!Array.isArray(items) || items.length === 0 || !processed) break;
          totalProcessed += Number(processed ?? 0);
          totalFailed += items.filter((item: { ok?: boolean }) => !item.ok).length;
          totalMatched += items.filter(
            (item: { ok?: boolean; result?: { matched?: boolean } }) =>
              item.ok && item.result?.matched,
          ).length;
          if (items.length < 250) break;
        }

        if (totalProcessed > 0) {
          window.dispatchEvent(new CustomEvent("sauti:data-changed"));
          (totalFailed ? toast.warning : toast.success)(
            `M-Pesa queue processed ${totalProcessed} confirmation(s); ${totalMatched} matched member account(s).${totalFailed ? ` ${totalFailed} need review.` : ""}`,
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
  }, []);
  return null;
}
