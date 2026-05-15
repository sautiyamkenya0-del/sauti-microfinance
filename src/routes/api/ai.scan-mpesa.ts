import { createFileRoute } from "@tanstack/react-router";
import { extractGroqJson } from "@/lib/groq.server";

/** AI scan for petty-cash entries — accepts an M-PESA screenshot (data-URL) and/or message text,
 *  returns structured fields { date, time, type, payee, contact, details, amount, txnCost, mode, reference }.
 */
export const Route = createFileRoute("/api/ai/scan-mpesa")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { imageDataUrl, text } = await request.json();
          const userContent: any[] = [];
          if (!imageDataUrl && !text)
            return Response.json({ error: "Provide image or text." }, { status: 400 });

          if (text)
            userContent.push({ type: "text", text: `M-PESA / bank message text:\n${text}` });
          if (imageDataUrl)
            userContent.push({ type: "image_url", image_url: { url: imageDataUrl } });
          userContent.push({
            type: "text",
            text: "Extract one petty-cash entry and return only a JSON object with keys: date, time, type, payee, contact, details, amount, txnCost, mode, reference. Use YYYY-MM-DD for date, HH:MM 24h for time, integers for amount/txnCost, empty strings for unknown text fields, and 0 for unknown numeric fields.",
          });

          const parsed = await extractGroqJson([
            {
              role: "system",
              content:
                "You extract petty-cash entries from Kenyan M-Pesa screenshots and SMS messages. Return valid JSON only.",
            },
            { role: "user", content: userContent },
          ]);
          return Response.json({ ok: true, entry: parsed });
        } catch (e: any) {
          console.error("scan-mpesa error", e);
          return Response.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
        }
      },
    },
  },
});
