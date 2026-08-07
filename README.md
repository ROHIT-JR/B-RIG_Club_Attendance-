# B-RIG Club Attendance System

B-RIG is a QR attendance system with a student frontend on Vercel, a private server-to-server proxy, Google Apps Script business logic, and Google Sheets storage. Students open only the Vercel or custom student domain. They do not visit an Apps Script URL, select a Google account, or sign in to Google.

## Features

- Signed QR links that expire after 25 seconds and rotate about every 10 seconds
- Five-minute access grants bound to one browser identifier and one session
- Existing-student lookup and optional first-time registration
- Institutional roll-number validation using `CB.SC.U4CYS25048` format
- Duplicate roll and one-attendance-per-browser enforcement under `LockService`
- Immediate Google Sheets check-in logging and dashboard updates
- Administrator session controls in the Google Sheets menu
- Mobile-first student UI with retry states and reduced-motion support
- Same-origin Vercel API with payload validation, secret redaction, timeouts, and rate limiting

## Architecture

```text
Administrator in Google Sheets
  -> Apps Script AdminSidebar.html
  -> rotating signed QR

Student browser
  -> https://attendance.example.org/?session=...&access=...&expires=...
  -> POST /api/attendance on the same Vercel origin
  -> Vercel adds APPS_SCRIPT_API_SECRET on the server
  -> Apps Script /exec doPost(e)
  -> Google Sheets
```

The browser bundle never contains the Apps Script URL or API secret. Apps Script accepts only `sessionDetails`, `validateRoll`, and `submitAttendance` requests carrying the server-only secret. The public Apps Script `doGet()` returns status JSON only; it does not host the student interface.

## Technology

| Component | Technology |
| --- | --- |
| Student frontend | Static HTML, CSS, and vanilla JavaScript on Vercel |
| Same-origin API | Vercel Node.js serverless function |
| Business logic | Google Apps Script V8 runtime |
| Data store | Google Sheets |
| Apps Script deployment | Clasp and Apps Script web app deployment |

## Requirements

- Node.js 20 or newer with `npm`
- Git
- A Google account that can own a Sheet and deploy an anonymous Apps Script web app
- A Vercel account and project
- A modern student browser with persistent site storage enabled

Some managed Google Workspace domains prohibit anonymous Apps Script deployments. The administrator must use an account that permits **Who has access: Anyone**. This Google restriction affects the Vercel-to-Apps-Script backend connection, not student Google accounts.

## Install

### 1. Get the project

```bash
git clone https://github.com/ROHIT-JR/B-RIG_Club_Attendance-.git B-RIG_Club_Attendance
cd B-RIG_Club_Attendance
npm ci
npm test
```

`npm test` runs the Apps Script logic, architecture-boundary, and Vercel proxy tests.

### 2. Connect a Google Sheet

1. Create a blank Google Sheet.
2. Open **Extensions > Apps Script**.
3. Open **Project Settings** and copy the Script ID.
4. Enable the Google Apps Script API in the administrator account's Apps Script user settings.
5. Create an untracked `.clasp.json` in the repository root:

```json
{"scriptId":"PASTE_YOUR_SCRIPT_ID_HERE","rootDir":"."}
```

6. Authenticate and upload the Apps Script files:

```bash
npx clasp login
npx clasp push --force
```

7. Refresh the Sheet.
8. Select **Club Attendance > Setup / Initialise Workbook**.

Initialization creates or upgrades these sheets without deleting existing settings or attendance records. It can rewrite formula-like historical `User Agent` cells as safe text:

- `Attendance Dashboard`
- `Students`
- `Sessions`
- `Checkins`
- `Settings`

Do not rename required sheets or standard headers. `.clasp.json` identifies the Apps Script project and must not be committed.

### 3. Create the shared server secret

Generate a random secret of at least 32 characters. This cross-platform Node.js command creates a 64-character value:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Store the same value in both server environments:

1. In Apps Script, open **Project Settings > Script Properties**.
2. Add a property named `VERCEL_API_SECRET` with the generated value.
3. Keep the value available temporarily for the Vercel configuration step.

Do not put the value in `.env.example`, source files, browser code, URLs, a Sheet cell, screenshots, issue reports, or Git history.

### 4. Deploy Apps Script as the backend

1. In Apps Script, select **Deploy > New deployment**.
2. Choose **Web app**.
3. Set **Execute as** to **Me**.
4. Set **Who has access** to **Anyone**.
5. Deploy and complete administrator authorization.
6. Copy the production URL matching `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`.

The `/exec` URL is a backend credential-like configuration value. Give it only to administrators and Vercel. Never put it in the student URL or the `Student Web App URL` Sheet setting.

Opening the `/exec` URL directly should return JSON similar to:

```json
{"ok":true,"service":"B-RIG Attendance API","studentFrontend":"external"}
```

### 5. Deploy the student app on Vercel

Import the repository into Vercel and configure:

| Vercel option | Value |
| --- | --- |
| Framework preset | Other |
| Root Directory | `vercel` |
| Build command | Leave empty |
| Output directory | Leave empty |

Add these server-side environment variables for Production:

| Variable | Value |
| --- | --- |
| `APPS_SCRIPT_URL` | The Apps Script production `/exec` URL |
| `APPS_SCRIPT_API_SECRET` | The exact value stored as `VERCEL_API_SECRET` |

Add the variables to Preview too only if preview deployments will be used for attendance testing. Redeploy after adding or changing environment variables.

The stable student address must be a root HTTPS origin, for example:

```text
https://b-rig-attendance.vercel.app
https://attendance.example.edu
```

Paths, query strings, fragments, HTTP URLs, numeric hosts, Google-hosted URLs, and GitHub Pages hosts are not accepted for QR generation. A root preview origin can pass format validation but is not stable; do not configure a deployment-specific preview URL. A custom domain is supported when it points to the Vercel project root.

The function includes warm-instance request limits. For distributed production enforcement, also configure a Vercel Firewall rate-limit rule for POST requests to `/api/attendance`. Choose a limit that accommodates many students behind the same campus NAT address; monitor normal meeting traffic before tightening it.

### 6. Connect QR generation to Vercel

In the Sheet's `Settings` tab, set `Student Web App URL` to the stable Vercel or custom root origin. Do not paste the Apps Script `/exec` URL.

Refresh the Sheet and select **Club Attendance > Create New Attendance Session**. Decode or scan the displayed QR and confirm:

- The hostname is the configured Vercel or custom hostname.
- The only attendance parameters are `session`, `access`, and `expires`.
- No URL includes `script.google.com`, `authuser`, GitHub Pages, or `qr.html`.
- A student with multiple Google accounts signed in reaches the student form without a Google page.

Complete the production checklist in [`TESTING.md`](TESTING.md) before using the system at a meeting.

## Configuration

### Sheet settings

| Setting | Purpose | Default |
| --- | --- | --- |
| `Club Name` | Name shown in the student interface | `Student Club` |
| `Student Web App URL` | Trusted root HTTPS student frontend origin | Must be configured |
| `New registrations require approval` | Creates new students as Pending when `TRUE` | `FALSE` |
| `Default attendance window in minutes` | Default new-session duration | `60` |
| `Time zone` | IANA time zone used for display and dashboard dates | `Asia/Kolkata` |
| `Version` | Installed workbook schema version | `2.0.0` |

`Public Web App URL` is a migration-only fallback for an older installation. An old Apps Script, GitHub Pages, or path-based value is rejected. Configure `Student Web App URL` and remove operational dependence on the legacy row.

Only trusted administrators should be able to edit `Settings`. QR generation intentionally trusts the configured custom student origin after validating that it is a root HTTPS domain and not Google-hosted.

The configured `Time zone`, `appsscript.json` `timeZone`, and the Google Sheet time zone under **File > Settings** must match. The repository defaults to `Asia/Kolkata`. To use another zone, update all three locations, upload the manifest, and publish a new Apps Script version before creating sessions.

When registration approval is enabled, the first check-in is recorded and the new `Students` row is marked Pending. An administrator approves future check-ins by changing that row's `Status` to `Active`. Until then, later scans show an approval-pending message.

### Server settings

| Location | Name | Visibility |
| --- | --- | --- |
| Apps Script Script Properties | `VERCEL_API_SECRET` | Server only |
| Vercel environment | `APPS_SCRIPT_URL` | Server only |
| Vercel environment | `APPS_SCRIPT_API_SECRET` | Server only |
| Apps Script Script Properties | `QR_SIGNING_SECRET` | Generated automatically, server only |

## Roll Numbers

Accepted roll numbers use this structure:

```text
CB.SC.U4CYS25048
|______||_||_||_|
Programme Dept Year Roll
```

| Segment | Rule | Example |
| --- | --- | --- |
| Programme | Fixed prefix | `CB.SC.U4` |
| Department | Exactly three letters | `CYS` |
| Joining year | Exactly two digits | `25` |
| Roll sequence | Exactly three digits | `048` |

Input is normalized to uppercase and validated in both the browser and Apps Script.

## Security Model

### QR and grants

- The admin dialog receives a temporary admin grant and renews it while the dialog remains open.
- The displayed QR rotates about every 10 seconds and each signed link expires after 25 seconds.
- A valid scan receives a five-minute grant bound to the session and browser UUID hash.
- A copied grant cannot be reused with a different browser UUID.
- The session state and time window are checked again during final submission.

A live QR can still be photographed and transmitted before it expires. Fully proving physical presence requires another trusted signal such as administrator verification, institutional authentication, or a managed application.

### Browser device control

The student app stores a random UUID in persistent `localStorage`. Apps Script stores only its SHA-256 hash. Within one session, the same roll cannot be checked in twice and the same stored browser UUID cannot submit a second roll.

This is a practical proxy-attendance deterrent, not hardware identity. Clearing site data, changing browsers, using isolated in-app WebViews, or using another device creates a new identifier. Students should scan with their normal Chrome, Safari, Firefox, or Samsung Internet browser and keep site storage enabled.

### API boundaries

- Attendance API traffic from the browser goes only to same-origin `/api/attendance`.
- Vercel validates methods, content type, body size, action names, field types, and field lengths.
- Vercel adds the API secret only after validation and redacts secrets from upstream JSON.
- Apps Script independently verifies the secret and action fields.
- Attendance checks and writes run under `LockService`.
- Untrusted spreadsheet text is sanitized before storage.
- Security headers deny framing and restrict scripts, forms, images, and network connections.

The student page also loads visual assets from the origins allowed in `vercel/vercel.json`; those non-executable font and image resources are not integrity-pinned. The administrator dialog loads QRCode.js from cdnjs with a fixed version and Subresource Integrity hash; it fails closed if the verified library cannot load.

In-memory proxy rate limits apply per warm Vercel function instance. They reduce repeated-browser and single-instance abuse but are not a global distributed quota. Use Vercel Firewall or another durable rate-limit store when stricter abuse protection is required.

## Daily Use

| Menu command | Purpose |
| --- | --- |
| `Create New Attendance Session` | Creates a timed session and opens its rotating QR |
| `Show Current QR Code` | Reopens the latest open session QR |
| `Close Current Session` | Stops further check-ins |
| `Reset / Clear All Sessions` | Deletes session and check-in history but keeps students |
| `Setup / Initialise Workbook` | Adds missing sheets, headers, and settings safely |

The reset action cannot be undone. Make a Sheet copy before clearing production data. The lock prevents concurrent writes but Google Sheets does not provide multi-range transactions; if a reset operation fails partway through, inspect the workbook and rerun reset from the backup or a known state.

## Updating

Run tests before every deployment:

```bash
git pull
npm ci
npm test
```

For Apps Script changes:

```bash
npx clasp push --force
```

Then select **Deploy > Manage deployments**, edit the existing web app, choose **New version**, and deploy. `clasp push` updates source but does not change an existing versioned `/exec` deployment. Keeping the same deployment preserves `APPS_SCRIPT_URL`.

For frontend or proxy changes, deploy the updated commit through Vercel. Run **Setup / Initialise Workbook** once after an update that adds settings or headers. Setup also neutralizes formula-like values left in the historical `User Agent` column by older deployments.

To rotate the API secret, generate a new value and update both `VERCEL_API_SECRET` and `APPS_SCRIPT_API_SECRET` during a short maintenance window, then redeploy Vercel. A mismatch causes temporary API failure but does not expose either value.

## Legacy Upgrade

Use this order when migrating an installation that sent students to Apps Script or a GitHub Pages redirect:

1. Pull this version and run `npm test`.
2. Upload Apps Script and run **Setup / Initialise Workbook**.
3. Create `VERCEL_API_SECRET` and publish a new Apps Script web app version.
4. Deploy `vercel` with the matching environment variables.
5. Set `Student Web App URL` to the stable Vercel or custom root origin.
6. Create a fresh session and complete [`TESTING.md`](TESTING.md).
7. Merge and deploy deletion of the old `qr.html` page, or disable the old GitHub Pages source.
8. Verify every previously published redirect URL is unavailable and no current QR uses it.

Do not reuse an old QR. Existing remote GitHub Pages content remains reachable until the branch deleting it is merged into the configured Pages source and GitHub finishes publishing.

## Troubleshooting

### A student sees a Google account chooser, Drive error, or `script.google.com`

The student followed an obsolete or misconfigured URL. Multiple Google accounts are not a special case in the hybrid architecture and private browsing is not required.

1. Decode the current QR and verify its hostname is the Vercel/custom student host.
2. Set `Settings > Student Web App URL` to the root HTTPS student origin.
3. Close obsolete sessions and generate a fresh QR.
4. Remove or disable any old GitHub Pages redirect.

### The QR dialog says the student URL is not configured

Use a root HTTPS origin such as `https://club.vercel.app`. Remove paths, query strings, fragments, Apps Script URLs, and trailing deployment routes. Reopen the QR dialog after correcting the setting.

### The student page says attendance is temporarily unavailable

Check the following without exposing values in screenshots or logs:

1. `APPS_SCRIPT_URL` is an active production `/exec` deployment.
2. Apps Script is deployed as **Execute as: Me** and **Who has access: Anyone**.
3. `APPS_SCRIPT_API_SECRET` exactly matches the `VERCEL_API_SECRET` Script Property.
4. Vercel was redeployed after environment changes.
5. The Apps Script `/exec` URL returns the status JSON when opened by an administrator.

### The browser reports too many requests

Wait for the one-minute window and retry once. If legitimate meeting traffic is affected, inspect Vercel Firewall logs and account for students sharing one campus IP before adjusting limits.

### The secure link or grant expired

Scan the currently displayed QR again. Old images expire after about 25 seconds and an already-open form must be completed within five minutes.

### Browser storage cannot be used

Open the link in the phone's normal browser and allow persistent site storage. Private tabs, scanner WebViews, and browsers that erase data cannot reliably retain the device identifier or receipt.

### The admin QR says reconnecting

The dialog retries transient Apps Script failures automatically. Check the administrator connection. If it does not recover, close and reopen **Show Current QR Code** while the session is still open.

### Code changes are not live

Publish a new Apps Script deployment version for `.js` or `AdminSidebar.html` changes. Redeploy Vercel for files under `vercel/`. Confirm the Sheet points to the stable production Vercel origin rather than an old preview.

### `clasp` reports that the Apps Script API is disabled

Enable the Google Apps Script API in the administrator account's Apps Script user settings, wait a few minutes, and run `npx clasp push --force` again.

### Check-in schema validation fails

Do not reorder standard `Checkins` columns. Run **Setup / Initialise Workbook** to append a missing `Device ID` column. Restore renamed or reordered headers manually before accepting attendance.

## Project Structure

| Path | Responsibility |
| --- | --- |
| `Code.js` | Admin menu, sessions, signed QR, JSON API, grants, and attendance workflow |
| `Config.js` | Constants, validation, hashing, and Sheet settings |
| `Database.js` | Sheet queries, duplicate checks, schema enforcement, and locking |
| `AdminSidebar.html` | Administrator-only rotating QR dialog |
| `appsscript.json` | Apps Script runtime and web app settings |
| `vercel/index.html` | Standalone student interface |
| `vercel/styles.css` | Responsive student styling |
| `vercel/app.js` | Browser state, device UUID, API calls, and UI workflow |
| `vercel/api/attendance.js` | Validating Vercel-to-Apps-Script proxy |
| `vercel/vercel.json` | Function duration and browser security headers |
| `test/` | Apps Script and architecture regression tests |
| `vercel/test/` | Proxy unit tests |

## Privacy

The Sheet contains student identity and attendance records. Restrict Sheet edit access, avoid exporting logs unnecessarily, set an appropriate retention policy, and close sessions promptly. Signed QR parameters may appear in Vercel request metadata and expire quickly; restrict observability access and retention. Never commit `.clasp.json`, production environment files, API secrets, or exported student data.
