// Use Node's global fetch (available in Node 18+)

function darajaTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}${value("month")}${value("day")}${value("hour")}${value("minute")}${value("second")}`;
}

function formatPhone(value) {
  let phone = String(value ?? "").trim();
  if (phone.startsWith("+")) phone = phone.slice(1);
  phone = phone.replace(/\D/g, "");
  if (phone.startsWith("0")) phone = `254${phone.slice(1)}`;
  if (/^7\d{8}$/.test(phone) || /^1\d{8}$/.test(phone)) phone = `254${phone}`;
  return phone;
}

(async () => {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const phoneRaw = process.env.TARGET_PHONE; // e.g. 079... or 2547...
  const amount = Number(process.env.STK_AMOUNT || "1");

  if (!consumerKey || !consumerSecret || !shortcode || !passkey) {
    console.error("Missing MPESA creds in env");
    process.exit(2);
  }
  const msisdn = formatPhone(phoneRaw);
  if (!/^254[17]\d{8}$/.test(msisdn)) {
    console.error("Invalid phone after formatting:", msisdn);
    process.exit(2);
  }

  // get token
  try {
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
    const tokenRes = await fetch(
      "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: { Authorization: `Basic ${auth}` },
      },
    );
    const tokenBody = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenBody.access_token) {
      console.error("Failed to get token", tokenRes.status, tokenBody);
      process.exit(1);
    }
    const token = tokenBody.access_token;

    // build stk push body
    const timestamp = darajaTimestamp();
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
    const body = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: msisdn,
      PartyB: shortcode,
      PhoneNumber: msisdn,
      CallBackURL:
        process.env.CALLBACK_URL || "https://business.sautiyamkenya.co.ke/api/confirmation",
      AccountReference: process.env.ACCOUNT_REF || "SBC",
      TransactionDesc: process.env.DESCRIPTION || "Sauti test",
    };

    const res = await fetch("https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const resBody = await res.json().catch(() => ({}));
    console.log("status", res.status);
    console.log("body", JSON.stringify(resBody, null, 2));
  } catch (e) {
    console.error("error", e?.message ?? e);
    process.exit(1);
  }
})();
