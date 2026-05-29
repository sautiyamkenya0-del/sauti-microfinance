import logo from "@/assets/sauti-logo.png";

export type LetterFact = {
  label: string;
  value: string | number;
};

type LetterDownloadArgs = {
  title: string;
  body: string;
  date?: string;
  recipientName?: string;
  recipientId?: string;
  facts?: LetterFact[];
  filename?: string;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slug(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "letter"
  );
}

async function logoDataUrl() {
  try {
    const response = await fetch(logo);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? logo));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return logo;
  }
}

export function normalizeLetterFacts(value: unknown): LetterFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const label = String(row.label ?? "").trim();
      const factValue = row.value;
      if (!label || factValue == null || String(factValue).trim() === "") return null;
      return { label, value: String(factValue) };
    })
    .filter(Boolean) as LetterFact[];
}

function letterHtml(args: LetterDownloadArgs & { logoSrc: string }) {
  const date = args.date || new Date().toISOString().slice(0, 10);
  const facts = args.facts ?? [];
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(args.title)}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    body { margin: 0; font-family: Arial, sans-serif; color: #172033; background: #f4f7fb; }
    .page { position: relative; min-height: 277mm; max-width: 210mm; margin: 0 auto; background: #fff; padding: 26mm 20mm 22mm; box-sizing: border-box; overflow: hidden; }
    .watermark { position: absolute; inset: 0; display: grid; place-items: center; opacity: 0.06; pointer-events: none; }
    .watermark img { width: 58%; max-width: 420px; }
    header { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 24px; border-bottom: 3px solid #1d4ed8; padding-bottom: 14px; }
    .brand { display: flex; align-items: center; gap: 14px; }
    .brand img { width: 72px; height: 72px; object-fit: contain; }
    .brand h1 { margin: 0; font-size: 24px; line-height: 1.1; letter-spacing: 0; }
    .brand p { margin: 4px 0 0; font-size: 12px; color: #5f6c80; }
    .date { text-align: right; font-size: 12px; color: #5f6c80; }
    main { position: relative; padding-top: 24px; font-size: 14px; line-height: 1.72; }
    h2 { margin: 0 0 14px; font-size: 19px; letter-spacing: 0; }
    .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; margin: 0 0 22px; padding: 12px; background: #f6f9ff; border: 1px solid #d8e2f3; border-radius: 6px; }
    .meta div { font-size: 12px; }
    .meta span { display: block; color: #64748b; text-transform: uppercase; font-size: 9px; letter-spacing: .08em; }
    .body { white-space: pre-wrap; }
    footer { position: absolute; left: 20mm; right: 20mm; bottom: 11mm; border-top: 1px solid #d8e2f3; padding-top: 8px; font-size: 10px; color: #64748b; display: flex; justify-content: space-between; gap: 16px; }
  </style>
</head>
<body>
  <section class="page">
    <div class="watermark"><img src="${args.logoSrc}" alt="" /></div>
    <header>
      <div class="brand">
        <img src="${args.logoSrc}" alt="Sauti logo" />
        <div>
          <h1>Sauti Microfinance</h1>
          <p>Amplifying the Voice of Business</p>
        </div>
      </div>
      <div class="date">Date<br /><strong>${escapeHtml(date)}</strong></div>
    </header>
    <main>
      <h2>${escapeHtml(args.title)}</h2>
      ${
        args.recipientName || args.recipientId || facts.length
          ? `<div class="meta">
              ${
                args.recipientName
                  ? `<div><span>Recipient</span>${escapeHtml(args.recipientName)}</div>`
                  : ""
              }
              ${
                args.recipientId
                  ? `<div><span>Member No.</span>${escapeHtml(args.recipientId)}</div>`
                  : ""
              }
              ${facts
                .map(
                  (fact) =>
                    `<div><span>${escapeHtml(fact.label)}</span>${escapeHtml(fact.value)}</div>`,
                )
                .join("")}
            </div>`
          : ""
      }
      <div class="body">${escapeHtml(args.body)}</div>
    </main>
    <footer>
      <span>Sauti Microfinance</span>
      <span>Official member communication</span>
    </footer>
  </section>
</body>
</html>`;
}

export async function downloadLetterheadHtml(args: LetterDownloadArgs) {
  const logoSrc = await logoDataUrl();
  const html = letterHtml({ ...args, logoSrc });
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download =
    args.filename ??
    `${String(args.date ?? new Date().toISOString().slice(0, 10))}-${slug(args.title)}.html`;
  link.click();
  URL.revokeObjectURL(url);
}

export function LetterheadDocument({
  title,
  body,
  date,
  recipientName,
  recipientId,
  facts = [],
}: LetterDownloadArgs) {
  return (
    <article className="relative overflow-hidden rounded-md border border-border bg-white p-6 text-slate-900 shadow-sm">
      <img
        src={logo}
        alt=""
        className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 object-contain opacity-[0.055]"
      />
      <header className="relative flex flex-wrap items-center justify-between gap-4 border-b-2 border-primary pb-4">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Sauti logo" className="h-14 w-14 object-contain" />
          <div>
            <div className="font-display text-xl font-semibold leading-tight">
              Sauti Microfinance
            </div>
            <div className="text-xs text-slate-500">Amplifying the Voice of Business</div>
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          Date
          <div className="font-medium text-slate-900">
            {date || new Date().toISOString().slice(0, 10)}
          </div>
        </div>
      </header>
      <main className="relative space-y-4 pt-5 text-sm leading-7">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {recipientName || recipientId || facts.length ? (
          <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
            {recipientName ? <PreviewFact label="Recipient" value={recipientName} /> : null}
            {recipientId ? <PreviewFact label="Member No." value={recipientId} /> : null}
            {facts.map((fact) => (
              <PreviewFact key={`${fact.label}-${fact.value}`} label={fact.label} value={fact.value} />
            ))}
          </div>
        ) : null}
        <p className="whitespace-pre-wrap">{body}</p>
      </main>
      <footer className="relative mt-8 flex flex-wrap justify-between gap-3 border-t border-slate-200 pt-3 text-[10px] uppercase tracking-wider text-slate-500">
        <span>Sauti Microfinance</span>
        <span>Official member communication</span>
      </footer>
    </article>
  );
}

function PreviewFact({ label, value }: LetterFact) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
