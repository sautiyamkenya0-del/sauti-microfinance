(async () => {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    console.error("Missing MPESA_CONSUMER_KEY or MPESA_CONSUMER_SECRET in environment");
    process.exit(2);
  }

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  try {
    const res = await fetch(
      "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: { Authorization: `Basic ${auth}` },
      },
    );
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch (e) {
      body = text;
    }

    if (res.ok && body && body.access_token) {
      console.log("OK");
      console.log("status", res.status);
      console.log("access_token_prefix", String(body.access_token).slice(0, 12) + "...");
    } else {
      console.error("FAILED");
      console.error("status", res.status);
      console.error("body", typeof body === "string" ? body : JSON.stringify(body));
    }
  } catch (e) {
    console.error("fetch error", e?.message ?? e);
    process.exit(1);
  }
})();
