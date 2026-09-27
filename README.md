# Gapwise

Find local businesses with website gaps (Graph8), audit them, have Claude build a working MVP site,
deploy it at `https://your-app/<business-name>`, and send outreach.

## How secrets are handled

| Secret | Where it lives |
| --- | --- |
| `MONGODB_URI`, `GAPWISE_SECRET`, `ADMIN_PASSWORD` | Server environment variables (Vercel project settings / local `.env`) |
| Claude Code OAuth token | Entered in **Settings**, stored in MongoDB encrypted with AES-256-GCM. Never set as an env var. |
| Graph8 API key | `G8_API_KEY` env var, or entered in **Settings** (stored AES-256-GCM encrypted in MongoDB; takes priority over the env var) |

- Settings is write-only: the browser sends a key once and the API only ever returns whether it is set.
  Keys never appear in page HTML, API responses, JS-readable cookies, or logs.
- **Delete** removes the stored token from MongoDB immediately. The token is read fresh on every
  MVP build (no cache), so the next build after a delete cannot use it.
- The Claude token is passed only to the Claude Code subprocess that builds the MVP, never put in `process.env`.
- Deployed MVP pages are served under a CSP sandbox, so a generated page cannot call the app's API with
  your session.
- If you rotate `GAPWISE_SECRET`, previously saved keys can no longer be decrypted; re-enter them in Settings.

## Admin and users

- The **admin** signs in with username `admin` and `ADMIN_PASSWORD`, manages keys in **Settings**, and
  manages people in **Users**.
- **Users** are added by the admin, or sign up themselves and are signed in straight away. A self sign-up
  starts with every key off until the admin switches them on (at most 30 sign-ups per hour).
- For each user the admin switches **Claude** (MVP generation) and **Graph8** (lead search and enrichment)
  on or off. Users share the workspace keys but never see them. Access is checked on the server for every
  request, so a change, disable or delete takes effect immediately. A password reset signs that user out.
- User passwords are hashed with scrypt in the `users` collection.
- Every lead search is saved with its results in the `searches` collection (latest 200 per person).
  **History** lists them and reopens one in Discover without calling Graph8 again. Users see only their
  own searches; the admin can switch to everyone's. Deleting a user deletes their history.

## Campaigns

- A **campaign** has a name, a goal, and an optional target (industries and locations).
- **Search in this campaign** opens Discover with the target filled in. Every search run there is saved under
  the campaign, and every lead it finds is saved to the campaign's lead list (`campaign_leads` collection, one
  entry per business, up to 1,000 per campaign). Enriching a lead from a campaign saves the enrichment too.
- The campaign page shows the saved leads and past searches; opening a search restores its results without
  calling Graph8 again. Users see their own campaigns; the admin can view everyone's.

## Local development

```bash
cp .env.example .env   # fill in MONGODB_URI, GAPWISE_SECRET (openssl rand -base64 48), ADMIN_PASSWORD
npm install
npm run dev            # app on http://localhost:5173, API on :3001
```

Sign in, open **Settings**, and save your Graph8 key and Claude token (`claude setup-token`).
Deployed MVPs are served at `http://localhost:5173/<business-name>`.

## Deploying to Vercel

1. Create a MongoDB Atlas cluster and, under **Network Access**, allow `0.0.0.0/0`
   (Vercel functions have no fixed IPs). Copy the connection string.
2. On vercel.com: **Add New → Project → Import** this GitHub repo. The framework is detected from `vercel.json`.
3. Under **Settings → Environment Variables**, add `MONGODB_URI`, `GAPWISE_SECRET`, `ADMIN_PASSWORD`,
   `G8_API_KEY` (and optionally `MONGODB_DB`). Do not add the Claude token here.
   If the MongoDB password contains special characters (`@ : / ? # %`), URL-encode them (`@` → `%40`).
4. Deploy, open the site, sign in, and add the Claude token in **Settings**.

Every `git push` to the production branch redeploys automatically.

### Notes

- MVP generation runs Claude Code through the Agent SDK. Its Linux binary (~240 MB) is too large for a
  Vercel function bundle, so the function downloads it from npm on a cold start (a few seconds),
  checks it against a pinned SHA-512 integrity hash, and caches it in `/tmp`. When upgrading
  `@anthropic-ai/claude-agent-sdk`, update `LINUX_BINARY` in `server/claude.ts`.
- A build can take 1–3 minutes; the function's `maxDuration` is 300 s (`vercel.json`).
- Claude subscription tokens (`claude setup-token`) are meant for your own use. If other people will
  use this app, save an Anthropic Console API key (`sk-ant-api…`) in the same Settings field instead;
  it is detected automatically.
