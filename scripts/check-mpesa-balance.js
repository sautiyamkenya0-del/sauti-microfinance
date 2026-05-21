(async () => {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const shortcode = process.env.MPESA_SHORTCODE;
  const securityCredential = process.env.MPESA_SECURITY_CREDENTIAL;
  const initiator = process.env.MPESA_INITIATOR_NAME || "apiop";
  const identifierType = process.env.MPESA_IDENTIFIER_TYPE || "4";
  const partyA = process.env.MPESA_PARTY_A || shortcode;
  const resultUrl = process.env.MPESA_RESULT_URL || "https://httpbin.org/post";
  const timeoutUrl = process.env.MPESA_TIMEOUT_URL || "https://httpbin.org/post";
  const remarks = process.env.MPESA_REMARKS || "Balance inquiry";
  const occasion = process.env.MPESA_OCCASION || "BalanceCheck";

  if (!consumerKey || !consumerSecret || !shortcode || !securityCredential) {
    console.error(
      "Missing required env vars. Set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_SECURITY_CREDENTIAL.",
    );
    process.exit(2);
  }

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  try {
    const tokenRes = await fetch(
      "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: { Authorization: `Basic ${auth}` },
      },
    );
    const tokenText = await tokenRes.text();
    let tokenBody;
    try {
      tokenBody = JSON.parse(tokenText);
    } catch {
      tokenBody = { raw: tokenText };
    }
    if (!tokenRes.ok || !tokenBody.access_token) {
      console.error("OAuth failed", tokenRes.status, tokenBody);
      process.exit(1);
    }
    const accessToken = tokenBody.access_token;

    const body = {
      Initiator: initiator,
      SecurityCredential: securityCredential,
      CommandID: "AccountBalance",
      PartyA: partyA,
      IdentifierType: identifierType,
      Remarks: remarks,
      QueueTimeOutURL: timeoutUrl,
      ResultURL: resultUrl,
      Occasion: occasion,
    };

    const res = await fetch("https://api.safaricom.co.ke/mpesa/accountbalance/v1/query", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const resText = await res.text();
    let resBody;
    try {
      resBody = JSON.parse(resText);
    } catch {
      resBody = resText;
    }
    console.log("status", res.status);
    console.log("response", JSON.stringify(resBody, null, 2));
  } catch (error) {
    console.error("request failed", error);
    process.exit(1);
  }
})();
