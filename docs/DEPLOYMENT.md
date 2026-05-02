# CloudTax × Wealthsimple Deployment Notes

## 1. AWS S3 IAM policy

The IAM user whose credentials are in `backend/.env` (`AWS_ACCESS_KEY_ID`)
**must** have the policy in [`aws-iam-policy.json`](./aws-iam-policy.json) attached.

If it doesn't, document upload silently falls back to local disk
(`backend/.local_storage/...`) which:
- Won't survive container restarts
- Doesn't replicate across pods
- Will surface a loud `[S3 ACCESS DENIED]` log line on first failure
- Will trigger an admin in-app alert (`s3_access_denied` notification)

### How to apply
```bash
aws iam put-user-policy \
  --user-name cloudtax-ws-pilot \
  --policy-name CloudTaxS3Access \
  --policy-document file://docs/aws-iam-policy.json
```

Or paste the JSON into the AWS Console → IAM → Users → `<user>` → Add inline policy.

## 2. Environment variables

- `backend/.env` — copy from `backend/.env.example`, fill real values.
- `frontend/.env` — copy from `frontend/.env.example`. The `REACT_APP_BACKEND_URL`
  is baked into the JS bundle at `yarn build` time. If the bundle is later
  served from a different host (e.g. you build against a preview URL but
  deploy to `ws.cloudtax.ca`), the **Admin-only URL Mismatch banner** in the
  app header will warn you on the next sign-in.

## 3. Production custom domain checklist (`ws.cloudtax.ca`)

When promoting the app to a custom domain:

1. **Build the frontend with the prod URL set**. Ensure
   `frontend/.env` contains `REACT_APP_BACKEND_URL=https://ws.cloudtax.ca`
   *before* the deploy build runs. If your CI rebuilds from `.env.example`,
   inject the value via the deploy pipeline.

2. **DNS**: `ws.cloudtax.ca` CNAME → the deployment's ingress hostname.

3. **Cookies / 2FA "trust this device"**: the trust cookie is
   `SameSite=None; Secure; HttpOnly`. Both the API and the SPA must be on
   HTTPS, and `axios` must be called with `withCredentials: true` (already
   configured in `frontend/src/lib/api.js`).

4. **CORS**: `backend/server.py` `CORSMiddleware` `allow_origins` should
   include the prod origin once it's known (currently `*` for development).

5. **Verify after deploy**:
   - Sign in as `nim@cloudtax.ca` → 2FA OTP arrives → token issued.
   - Refresh; subsequent `/api/users/me` returns 200 (no 401 — auth header
     persists from `sessionStorage`).
   - Admin sees no red URL Mismatch banner in the AppHeader.
   - Upload any document on a test engagement → check backend logs for
     `[S3 ACCESS DENIED]`. If absent and the file appears in
     `https://cloudtax-ws-pilot.s3.ca-central-1.amazonaws.com/...`,
     prod S3 is healthy.

## 4. Resend email deliverability

- API key in `RESEND_API_KEY`.
- `From:` domain (`ws.cloudtax.ca`) must be verified at
  https://resend.com/domains with SPF/DKIM/Return-Path records present.
- The `email_service.send_invite_async()` helper returns a real `success`
  boolean; the legacy sync `send_invite()` always returns `scheduled=True`
  and should not be used for new code paths.
