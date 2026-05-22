# M-Pesa C2B Registration Fix

## The Problem

You noticed that **manual M-Pesa PayBill transactions are not appearing in Vercel logs**, even though STK Push confirmations (prompted payments) work perfectly.

This is not a code bug. Your new TanStack/React codebase is **100% ready** to accept C2B transactions. The issue is a **configuration gap** between your old PHP site and your new React site.

## Root Cause

Safaricom's servers are still configured to send manual PayBill callbacks to your **old PHP endpoints**:

- `https://business.sautiyamkenya.co.ke/api/confirmation`
- `https://business.sautiyamkenya.co.ke/api/validation`

Your old PHP code had a `registerUrl()` function that executed a one-time registration with Safaricom to tell them: _"Route all unprompted payments to this URL."_

When you migrated to the new React site (now at `sbm.sautiyamkenya.co.ke` or your new domain), you didn't re-register, so Safaricom is **still pointing to the old location**.

### Why STK Works But C2B Doesn't

- **STK Push (Prompted)**: When you initiate an STK prompt from your app, you include the callback URL **in that specific request**. Safaricom sends that response to the URL you just told them about.
- **C2B (Manual/Unprompted)**: When someone manually enters your shortcode in their M-Pesa menu and sends a payment, Safaricom uses the **permanently registered callback URL** to route the data.

## The Solution

You need to call Safaricom's `RegisterURL` endpoint **one time** to update their routing configuration to point to your new React site endpoints.

### Option 1: Use the Admin Registration Endpoint (Recommended)

A new route has been added at:

```
POST /api/admin/mpesa/register-c2b-urls
```

#### Steps:

1. **Ensure you're logged in as a Manager or Director** (or equivalent admin role).

2. **Call the endpoint** (replace domain with your actual domain):

   ```bash
   curl -X POST https://sbm.sautiyamkenya.co.ke/api/admin/mpesa/register-c2b-urls \
     -H "Cookie: [your-session-cookie]"
   ```

   Or use Postman/Insomnia with your session cookie.

3. **Expected success response:**

   ```json
   {
     "ok": true,
     "shortcode": "4157239",
     "confirmationUrl": "https://sbm.sautiyamkenya.co.ke/api/public/payments/confirmation",
     "validationUrl": "https://sbm.sautiyamkenya.co.ke/api/public/payments/validation",
     "response": {
       "ResponseCode": "0",
       "ResponseDescription": "success"
     }
   }
   ```

4. **If there's an error**, check:
   - Are your MPESA environment variables set? (`MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`)
   - Is the endpoint environment (sandbox vs production) correct?
   - Is your Daraja OAuth working? (Check error logs for auth failures.)

### Option 2: Manual cURL (If You Prefer)

If you already have a Daraja access token:

```bash
# Step 1: Get access token (if you don't have one)
curl -X GET "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials" \
  -H "Authorization: Basic $(echo -n 'YOUR_CONSUMER_KEY:YOUR_CONSUMER_SECRET' | base64)"

# Step 2: Register the URL (replace YOUR_ACCESS_TOKEN)
curl -X POST https://api.safaricom.co.ke/mpesa/c2b/v2/registerurl \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ShortCode": "4157239",
    "ResponseType": "Completed",
    "ConfirmationURL": "https://your-domain.com/api/public/payments/confirmation",
    "ValidationURL": "https://your-domain.com/api/public/payments/validation"
  }'
```

## What Happens After Registration

1. Safaricom will update their routing tables immediately (usually within seconds).
2. The next manual PayBill transaction will be routed to your new React site.
3. Your `POST /api/public/payments/confirmation` endpoint will receive the callback.
4. The transaction will be processed by your `applyMpesaPaymentToDatabase` logic.
5. You'll see new logs in your `error_logs` table and Vercel console with summaries like:
   ```
   mpesa confirmation normalized (for visibility): {
     "account": "MEMBER_ID",
     "amount": 100,
     "mpesaRef": "LIJ12345678",
     "success": true,
     "businessShortCode": "4157239"
   }
   ```

## Verification

After registration:

1. **Ask someone to make a test payment** to your shortcode manually.
2. **Check Vercel logs** at `https://vercel.com/dashboard` → Your Project → Logs.
3. **Search for `mpesa confirmation normalized`** in the logs—you should see the payload.
4. **Check the Supabase `mpesa_events` table** to verify the row was inserted with `kind='confirmation'`.
5. **Check the `transactions` table** to see if an allocation was made.

## Configuration Notes

- **Domain**: The registration uses `MPESA_PUBLIC_BASE_URL`, then `PUBLIC_BASE_URL`, then `MPESA_DOMAIN`, then the current request origin. Update one of these if your domain changes.
- **Endpoints**: The fixed endpoints are:
  - Confirmation: `/api/public/payments/confirmation`
  - Validation: `/api/public/payments/validation`
- **Safe path**: The registration uses `/payments/*` callback paths and keeps the older `/mpesa/*` handlers only for compatibility.
- **ResponseType**: Set to `"Completed"` (Safaricom's recommendation for handling timeouts).

## Troubleshooting

| Symptom                                | Likely Cause                         | Fix                                                      |
| -------------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| "Missing required MPESA configuration" | Env vars not set                     | Check `.env.local` or Vercel project settings            |
| "Failed to obtain access token"        | Bad consumer key/secret              | Verify credentials in Daraja portal                      |
| "Safaricom registration failed"        | Invalid shortcode or domain          | Verify shortcode; ensure domain is reachable             |
| Still no logs after registration       | Old PHP server intercepting requests | Check firewall/DNS; may need to take down old PHP server |

---

**TL;DR**: Run `POST /api/admin/mpesa/register-c2b-urls` once as an admin. Manual PayBill transactions will then flow to your new React site.
