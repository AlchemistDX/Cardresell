# eBay Production OAuth — Support Ticket Draft

**Filed by:** Will (willsep200@gmail.com)
**Date:** 2026-08-12
**Status:** Blocked — client_credentials grant returns 401 `invalid_client` on Production

## Symptom

`POST https://api.ebay.com/identity/v1/oauth2/token` with:

- `Content-Type: application/x-www-form-urlencoded`
- Body: `grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope`
- Basic Auth: App ID (Client ID) + Cert ID (Client Secret) from developer.ebay.com/my/keys, Production keyset

Returns:

```
HTTP 401
{"error":"invalid_client","error_description":"client authentication failed"}
```

## What I verified

- App ID and Cert ID copied directly from developer.ebay.com/my/keys DOM (inspected element to rule out visual truncation)
- Sandbox OAuth works fine with the same code path against the Sandbox keyset
- User Token generation (authorization code flow) works fine on Production
- Cert ID rotation performed — same 401 with the fresh cert
- Values (masked):
  - App ID: `WillJone-Cardress-PRD-...b84aade6`
  - Cert ID: `PRD-ed1dfcd3dad8-...-4ca1`
- API License Agreement: accepted (see developer.ebay.com/my/agreements)

## Suspected cause

Production keyset appears to not be enrolled for the `client_credentials` grant type. Sandbox is enrolled by default; Production may require a manual enrollment step that isn't documented or visible in the current developer portal UI.

## Ticket text to send to eBay Developer Support

> My Production keyset (CardressII, App ID `WillJone-Cardress-PRD-10acbcbc9-b84aade6`) returns HTTP 401 `invalid_client` when I request a token via the client credentials grant at `https://api.ebay.com/identity/v1/oauth2/token`, even though the same app can generate user tokens successfully via the authorization code flow. Sandbox keyset works. I've verified the App ID + Cert ID are exact, and I've rotated the Cert ID once with no change. Please confirm whether my Production keyset is enrolled for the client_credentials grant type, and if not, enable it (or point me to the enrollment page). Scope needed: `https://api.ebay.com/oauth/api_scope`.

## When this is resolved

1. Re-save App ID + Cert ID as `custom-cred:api.ebay.com`
2. Rerun the OAuth test above — expect HTTP 200 with `access_token`
3. Wire the Browse API into `/api/ebay-sold.js` as primary path (public search parsing stays as fallback)
4. Add `EBAY_APP_ID` + `EBAY_CERT_ID` env vars on Vercel (already there, just double-check they're the values above)
5. Redeploy, verify median sold prices show up on card detail pages for Chaos Rising Charizard, etc.
