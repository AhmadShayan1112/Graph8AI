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
- **Graph8 for everyone**, **Gap analysis for everyone** and **Claude for everyone** (Users page) open that key to
  every user, including new sign-ups, on top of their own switches. Turning one off returns to per-user access.
  Claude for everyone means every user's MVP builds spend the workspace's Claude credits.
- User passwords are hashed with scrypt in the `users` collection.
- Every lead search is saved with its results in the `searches` collection (latest 200 per person).
  **History** lists them and reopens one in Discover without calling Graph8 again. Users see only their
  own searches; the admin can switch to everyone's. Deleting a user deletes their history.

## Campaigns

- **Every search belongs to a campaign.** A Discover search made outside a campaign is filed under the person's
  campaign with the same target (industries + locations), or a new campaign is created for it automatically, named
  after the search; Discover then continues inside that campaign. At the 100-campaign limit such searches go to
  one "Other searches" campaign. The app's own first-load search is not stored.

- A **campaign** has a name, a goal, and an optional target (industries and locations).
- **Search in this campaign** opens Discover with the target filled in. Every search run there is saved under
  the campaign, and every lead it finds is saved to the campaign's lead list (`campaign_leads` collection, one
  entry per business, up to 1,000 per campaign). Enriching a lead from a campaign saves the enrichment too.
- The campaign page shows the saved leads and past searches; opening a search restores its results without
  calling Graph8 again. Users see their own campaigns; the admin can view everyone's.

## Analysis

- **Analysis** (above Campaigns) sizes a campaign's target market with Graph8: how many businesses match, how
  many have no website or a phone number, and how the market splits by company size, revenue, city and
  industry (`POST /search/filter-options`). It also shows how much of that market the campaign's saved leads
  cover, their health scores and most common gaps.
- Market numbers are stored in `campaign_analysis` and only recomputed when someone clicks
  **Refresh from Graph8**, which needs Graph8 access.

## Gap analysis (Graph8 + Gemini)

- The admin saves a **Gemini API key** in **Settings** (encrypted like the other keys) and switches **Gap analysis**
  on per user (or for everyone) in **Users**. Users only ever see "gap analysis", never the provider.
- **Gap analysis** lists a campaign's saved leads. Per lead, the server takes Graph8's company record (when the user
  has Graph8 access) and has Gemini research the business with Google Search: gaps with evidence, what it is likely
  looking for, and a prospect profile (fit score, offer, pitch, talking points, email opener) with sources.
  Results are stored in `gap_analyses`, one per campaign lead.
- Runs live in an app-wide runner: they continue while you use other pages, show progress in the sidebar, and
  resume after a refresh. A lead that hits a usage limit is retried up to 5 times (30 s, 60 s, …) before pausing.

### Choosing Gemini models

- Settings → Gemini API key → **Model order**. Empty = *Automatic*: the cheapest model the key can use
  (Flash-Lite first), falling back to others when one is out of quota.
- Or set your own order: model 1, then model 2 if it fails, then model 3, … (up to 10, from the models the key
  offers). "If every model in this list fails, try the other models this key offers" is on by default.
- On a usage limit (429), calls cycle through the order with growing waits (up to 45 s for the assistant, 2 min for
  research). **Test key** shows which model answers or Google's exact error; the admin also sees Google's reason in
  error messages. `GEMINI_MODEL` is a server-side default used only when no order is set.

## Background jobs

MVP builds and gap-analysis runs are server-side jobs (`jobs` collection, `server/jobs.ts`), so they keep running
when the user switches pages, refreshes or closes the tab. Each job moves through steps (MVP: research → plan →
build; gap analysis: one lead per step). A step runs in its own function call, kept alive after the response with
Vercel's `waitUntil`, then hands the job to a fresh call through a signed internal route
(`/api/internal/jobs/:id/run`), so no call exceeds the 5-minute limit. A lock prevents a step from running twice;
a job whose step went quiet is restarted the next time anyone views their jobs. Failed steps are retried (usage
limits are waited out); a job that still fails can be resumed. Pages only watch jobs (`/api/jobs`).

## Assistant and human support

- A chat button (bottom right, on every page of the app) opens the **Gapwise assistant**. It answers questions
  about using Gapwise from a built-in product guide (`server/assistant.ts`), tailored to the person's role, tool
  access and current page, streams its replies, and links straight to pages. It runs on the same research key as
  gap analysis, never names the AI provider, and is limited to 30 messages per person per 10 minutes.
- **Talk to a person** in the assistant sends the question and the chat so far to the admin as a support
  request (`support_tickets`). The person follows it under **My requests**; a red dot shows new replies.
- The landing page has the same chat button with a **public** assistant for visitors (`/api/public/assistant`,
  no sign-in; 15 messages per visitor per 10 minutes and 300 per hour overall). Its **Talk to a person** is a
  contact form (name, email, question) that lands in Support with the visitor's email to reply to.
- The admin answers in **Support** (menu shows the open count): filter Open / Answered / Closed, read the
  request with its chat and page, reply, close or reopen.

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
