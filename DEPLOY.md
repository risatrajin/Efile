# Deploy — client demo

Architecture: **frontend on Vercel** (static CRA) + **backend on Render** (FastAPI
container) + **MongoDB Atlas** (database). ~20 min end-to-end.

```
[Vercel: React]  --HTTPS /api-->  [Render: FastAPI]  -->  [Atlas: MongoDB]
```

---

## 1. MongoDB Atlas (database) — ~5 min
1. https://cloud.mongodb.com → create free **M0** cluster.
2. **Database Access** → add user + password (save it).
3. **Network Access** → allow `0.0.0.0/0` (Render IPs are dynamic on free tier).
4. **Connect → Drivers** → copy the SRV string:
   `mongodb+srv://USER:PASS@cluster0.xxx.mongodb.net/?retryWrites=true&w=majority`
   → this is **`MONGO_URL`**. DB name = `cloudtax_ws_pilot`.

## 2. Backend on Render — ~8 min
1. https://render.com → **New → Blueprint** → connect this GitHub repo (`Efile`).
   Render reads [`render.yaml`](render.yaml) and creates the `efile-api` service.
2. Fill the prompted secrets:
   - `MONGO_URL` = Atlas string from step 1
   - `ADMIN_PASSWORD` = pick a demo password (e.g. `CloudTax2026!`)
   - `FRONTEND_URL` / `ALLOWED_ORIGINS` = leave blank for now (set in step 4)
   - `RESEND_*`, `EMERGENT_LLM_KEY` = optional (see **Demo caveats**)
3. Deploy. Wait for green. Note the URL, e.g. `https://efile-api.onrender.com`.
   Verify: open `https://efile-api.onrender.com/api/health` → should return ok.
4. **Seed demo data**: Render service → **Shell** tab → run `python seed.py`
   (idempotent — 10 clients, 2 CPAs, 2 partners, engagements at every stage).

## 3. Frontend on Vercel — ~4 min
1. https://vercel.com → **Add New → Project** → import the `Efile` repo.
2. **Root Directory** = `frontend`  (Framework auto-detects *Create React App*).
3. **Environment Variables** → add
   `REACT_APP_BACKEND_URL` = `https://efile-api.onrender.com`  (no trailing `/`).
4. Deploy. Note the URL, e.g. `https://efile.vercel.app`.

## 4. Wire CORS (connect the two) — ~2 min
1. Render → `efile-api` → **Environment** → set
   `FRONTEND_URL` = `https://efile.vercel.app`
   `ALLOWED_ORIGINS` = `https://efile.vercel.app`
2. Save → Render redeploys. Done.

---

## Demo logins
All use the password you set as `ADMIN_PASSWORD`/`SEED_PASSWORD`:
- **Admin** — `nim@cloudtax.ca`
- **CPA** — `pallavi@cloudtax.ca`, `terryann@cloudtax.ca`
- **Partner (Ownr)** — `henry.ziegler@wealthsimple.com`
- **Client** — `chen@example.com` (+ others from seed)

2FA is off on seed users → login returns a token directly (no OTP needed).

## Demo caveats
- **Email** (`RESEND_*` unset) — invites / password-reset / OTP are no-ops. Login
  still works (2FA off). Set a Resend key only if you want to demo email flows.
- **AI doc parsing** (`EMERGENT_LLM_KEY` unset) — upload works, auto-extraction
  disabled. Set the key to demo parsing.
- **Uploads** — persist to the container disk. Render free tier has ephemeral
  disk (wiped on redeploy/sleep). Fine for a live demo; add S3 (`AWS_*`) for
  durable storage.
- **Render free tier sleeps** after 15 min idle → first request after takes
  ~30 s to wake. Hit `/api/health` a minute before presenting, or use a paid
  instance for a smooth demo.

## Before going live
- Make the GitHub repo **Private** (Settings → General → Danger Zone) if this is
  client code — it's currently Public.
- Confirm `SHOW_DEV_FALLBACK_TOKENS=false` and `PRODUCTION=true` on Render
  (both set by `render.yaml`).
