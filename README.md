# B-RIG Club Attendance System

B-RIG is a QR attendance system with a student frontend on Vercel, a private server-to-server proxy, Google Apps Script business logic, and Google Sheets storage. Students open only the Vercel or custom student domain. They do not visit an Apps Script URL, select a Google account, or sign in to Google.

## Features

- Signed QR links that expire after 25 seconds and rotate about every 10 seconds
- Five-minute access grants bound to one browser identifier and one session
- Existing-student lookup and first-time registration with name and official college email
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

## Step-by-Step Deployment

Deploy the components in this order:

```text
Google Sheet and Apps Script source
  -> Apps Script server secret
  -> Apps Script /exec deployment
  -> Vercel project and environment variables
  -> stable Vercel/custom student URL
  -> Settings sheet
  -> end-to-end QR test
```

Do not generate a production QR until all steps are complete. Students must receive only the final Vercel or custom-domain URL.

### Values you will create

Keep this list available while deploying, but do not place real values in a tracked file:

| Value | Created in | Used in |
| --- | --- | --- |
| Script ID | Apps Script Project Settings | Local `.clasp.json` only |
| Spreadsheet ID | Workbook initialization | Apps Script `SPREADSHEET_ID`, created automatically |
| API secret | Local cryptographic command | Apps Script and Vercel server settings |
| Apps Script `/exec` URL | Apps Script deployment | Vercel `APPS_SCRIPT_URL` only |
| Student app URL | Vercel deployment or custom domain | Sheet `Student Web App URL` |

### Step 1: Verify local tools

Open PowerShell, Terminal, or your Linux shell and run:

```bash
node --version
npm --version
git --version
```

Confirm that Node.js is version 20 or newer. Install a current Node.js LTS release from [nodejs.org](https://nodejs.org/) and Git from [git-scm.com](https://git-scm.com/downloads) if either command is missing.

### Step 2: Download and test the project

Clone the repository and install the exact locked dependencies:

```bash
git clone https://github.com/ROHIT-JR/B-RIG_Club_Attendance-.git B-RIG_Club_Attendance
cd B-RIG_Club_Attendance
npm ci
npm test
```

Do not continue until all tests pass. `npm test` checks Apps Script behavior, the Vercel proxy, security boundaries, QR validation, duplicate enforcement, and the removal of legacy student-hosting files.

Optional security verification:

```bash
npm audit
```

The expected result is zero known dependency vulnerabilities.

### Step 3: Create the Google Sheet and bound Apps Script project

1. Sign in to the Google account that will own and administer attendance.
2. Open [Google Sheets](https://sheets.google.com) and create a blank spreadsheet.
3. Rename it to something recognizable, such as **B-RIG Club Attendance**.
4. Open **File > Settings** and set the spreadsheet time zone to `Asia/Kolkata`.
5. Select **Extensions > Apps Script**. Google creates a script project bound to the Sheet.
6. In Apps Script, select **Project Settings** in the left sidebar.
7. Copy the **Script ID**. This is not the deployment URL.
8. Leave the Apps Script browser tab open.

The repository manifest also uses `Asia/Kolkata`. If another zone is required, complete the time-zone alignment instructions under [Configuration](#configuration) before creating sessions.

### Step 4: Enable the Apps Script API

Clasp cannot upload files until the Apps Script API is enabled for the administrator account.

1. Open [Apps Script user settings](https://script.google.com/home/usersettings).
2. Turn on **Google Apps Script API**.
3. Wait a few minutes if it was just enabled.
4. Return to the local project directory.

### Step 5: Connect Clasp to the bound project

Create `.clasp.json` in the repository root with the Script ID copied in Step 3.

macOS or Linux:

```bash
printf '%s\n' '{"scriptId":"PASTE_YOUR_SCRIPT_ID_HERE","rootDir":"."}' > .clasp.json
```

Windows PowerShell:

```powershell
'{"scriptId":"PASTE_YOUR_SCRIPT_ID_HERE","rootDir":"."}' | Set-Content -Encoding ASCII .clasp.json
```

Authenticate Clasp using the same administrator account that owns the Sheet:

```bash
npx clasp login
```

Verify the upload boundary before pushing:

```bash
npx clasp status
```

The tracked Apps Script files should be:

- `AdminSidebar.html`
- `appsscript.json`
- `Code.js`
- `Config.js`
- `Database.js`

Upload them:

```bash
npx clasp push --force
```

Return to the Apps Script editor and refresh it. Confirm the five files are present. Never commit `.clasp.json`; it is already ignored by Git.

### Step 6: Initialize the workbook

1. Return to the Google Sheet and refresh the page.
2. Wait for the **Club Attendance** menu to appear beside the standard Sheet menus.
3. Select **Club Attendance > Setup / Initialise Workbook**.
4. Approve the administrator authorization request if Google displays one.
5. Wait for the **Workbook initialised successfully** alert.
6. Confirm that the following tabs now exist: `Attendance Dashboard`, `Students`, `Sessions`, `Checkins`, and `Settings`.
7. Open `Checkins` and confirm the exact ordered headers are `Checkin ID`, `Timestamp`, `Session ID`, `Session Date`, `Roll Number`, `Full Name`, `Result`, `Source`, `User Agent`, and `Device ID`.
8. Open `Students` and confirm `Official Email` and `Gender` are separate headers. New workbooks create both; existing workbooks require the controlled Gender migration below.
9. Open `Settings` and confirm that `Student Web App URL` exists. Leave its placeholder unchanged until Vercel is deployed.
10. Return to Apps Script **Project Settings > Script Properties** and confirm setup created `SPREADSHEET_ID`.

Initialization is safe to rerun when upgrading. It appends missing settings and headers without deleting attendance records, although it neutralizes formula-like historical `User Agent` values as safe text. It does not rearrange a damaged schema, so always verify the exact `Checkins` order after a repair. Do not rename required tabs or standard headers.

`Gender` is intentionally excluded from automatic upgrades of an existing `Students` sheet. Use **Check Gender Schema (Dry Run)** and **Apply Gender Schema Upgrade** so a verified timestamped spreadsheet copy exists before the single header write.

`SPREADSHEET_ID` lets the deployed web app open the bound workbook when Google provides no active spreadsheet context. Do not copy an ID from another workbook or delete this property in production. Setup can append a missing header, but it cannot safely repair a renamed or reordered standard column; compare the full order above before deployment.

If the custom menu does not appear, refresh the Sheet once more. If it is still absent, confirm `npx clasp push --force` succeeded, open Apps Script, run `onOpen` once as the administrator, and refresh the Sheet.

### Step 7: Generate and store the server secret

Generate a random 64-character secret locally:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copy the generated value without adding spaces or quotation marks. In Apps Script:

1. Open **Project Settings**.
2. Scroll to **Script Properties**.
3. Select **Add script property**.
4. Enter `VERCEL_API_SECRET` as the property name.
5. Paste the generated value as the property value.
6. Select **Save script properties**.

Keep the value available only until the matching Vercel variable is configured. Do not put it in `.env.example`, source code, browser code, URLs, Sheet cells, screenshots, chat messages, issue reports, or Git history.

`QR_SIGNING_SECRET` is created automatically by Apps Script on first use. Do not manually create or copy it.

### Step 8: Deploy Apps Script as the backend

1. In the Apps Script editor, select **Deploy > New deployment**.
2. Select the gear icon beside **Select type**.
3. Choose **Web app**.
4. Enter a description such as `B-RIG production API`.
5. Set **Execute as** to **Me**.
6. Set **Who has access** to **Anyone**.
7. Select **Deploy**.
8. Complete administrator authorization if prompted.
9. Copy the Web App URL ending in `/exec`.

The URL must match this shape:

```text
https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

Open the `/exec` URL from a signed-out browser or an unauthenticated HTTP client. The deployment route should return JSON similar to:

```json
{"ok":true,"service":"B-RIG Attendance API","studentFrontend":"external"}
```

This static response confirms that anonymous `doGet()` routing works. It does not test the Sheet connection, API secret, or Vercel proxy; Step 13 performs that verification. If Google shows an authorization or access error, verify the deployment settings before continuing. The `/exec` URL is backend configuration. Give it only to administrators and Vercel; never put it in a QR or the Sheet's `Student Web App URL` setting.

### Step 9: Import the Vercel project

1. Push the repository to GitHub if it is not already available there.
2. Sign in to [Vercel](https://vercel.com).
3. Select **Add New > Project**.
4. Import `ROHIT-JR/B-RIG_Club_Attendance-` or your fork.
5. Set the production branch to `main` if Vercel asks.
6. Choose **Other** for **Framework Preset**.
7. Select **Edit** beside **Root Directory** and enter `vercel`.
8. Leave **Build Command** empty.
9. Leave **Output Directory** empty.
10. Expand **Environment Variables** before deploying.

Add both variables exactly as shown:

| Variable | Value | Required scope |
| --- | --- | --- |
| `APPS_SCRIPT_URL` | The production Apps Script `/exec` URL from Step 8 | Production |
| `APPS_SCRIPT_API_SECRET` | The exact secret stored as `VERCEL_API_SECRET` | Production |

Variable names are case-sensitive. Do not add a `NEXT_PUBLIC_` prefix. Select **Deploy** after both variables are present.

If variables are added after the first deployment, open **Project Settings > Environment Variables**, add or correct them, then redeploy from the **Deployments** tab. Existing deployments do not automatically receive later environment changes.

Add the variables to Preview only when preview deployments will be used for controlled testing. Production attendance should use the stable production deployment.

### Step 10: Select the permanent student URL

After deployment, Vercel provides a stable production URL such as:

```text
https://b-rig-attendance.vercel.app
```

Open the URL. The page should load the B-RIG interface and explain that a fresh QR is required because no session parameters were supplied. A direct GET to `/api/attendance` returning `405 Method Not Allowed` is expected because that endpoint accepts POST only.

For a custom domain:

1. In Vercel, open **Project Settings > Domains**.
2. Add the domain, such as `attendance.example.edu`.
3. Apply the DNS records Vercel provides.
4. Wait until Vercel reports the domain as valid and HTTPS is active.
5. Open the custom root URL and confirm the same student page appears.

Use only one stable root HTTPS origin. Do not use a path, query string, fragment, HTTP URL, numeric host, Google application host, GitHub Pages host, or deployment-specific preview URL.

### Step 11: Configure the Sheet to generate Vercel QR links

1. Return to the Google Sheet.
2. Open the `Settings` tab.
3. Find the `Student Web App URL` row.
4. Replace the placeholder with the stable Vercel or custom root URL from Step 10.
5. Do not add a trailing path or any query parameters.
6. Do not paste the Apps Script `/exec` URL.
7. Set `Club Name` to the name students should see.
8. Confirm `Time zone` matches both the Sheet and `appsscript.json`.
9. Set `New registrations require approval` to `TRUE` or `FALSE` as required.
10. Set the default attendance duration in minutes.

Only trusted administrators should be able to edit `Settings`, because the configured student origin becomes the destination encoded in new QR codes.

### Step 12: Configure production rate limiting

The proxy contains per-instance limits, but a distributed production deployment should also use Vercel Firewall or another durable rate-limit service.

1. Open the Vercel project's security or firewall settings.
2. Create a rate-limit rule for requests whose path is `/api/attendance`.
3. Restrict the rule to `POST` when the interface permits method matching.
4. Start with a threshold that allows the expected meeting size.
5. Remember that many students may share one campus NAT IP address.
6. Test the rule in a preview or staging deployment before enforcing a lower production limit.
7. Monitor legitimate traffic during the first meeting and adjust conservatively.

Vercel product names and firewall availability vary by account plan. If distributed firewall rules are unavailable, retain the built-in limits and document the remaining quota-abuse risk.

### Step 13: Run the first end-to-end check-in

Prefer a separate staging Sheet, Apps Script deployment, and Vercel Preview for destructive or repeated testing. A completed production smoke test creates a permanent session, dashboard column, check-in, and possibly a student. There is no per-session cleanup command. If production must be tested directly, use an approved test identity, label the session clearly, close it, and retain the records as an audit trail. Never use the global reset command merely to remove one smoke test.

1. Refresh the Google Sheet.
2. Select **Club Attendance > Create New Attendance Session**.
3. Enter a session title, such as `Deployment smoke test`.
4. Enter a short duration, such as `10` minutes.
5. Wait for the rotating QR dialog.
6. Scan the QR with a phone's normal Chrome, Safari, Firefox, or Samsung Internet browser.
7. Confirm the browser stays on the Vercel or custom student hostname.
8. Confirm no Google account chooser, Google Drive page, Apps Script page, or GitHub redirect appears.
9. Enter a valid test roll such as `CB.SC.U4CYS25048`.
10. For a new student, enter the official name and the matching official email, such as `cb.sc.u4cys25048@cb.students.amrita.edu`.
11. Complete registration or confirm the existing test student.
12. Verify the success screen appears.
13. In `Students`, verify the official email is stored in its separate `Official Email` column.
14. In `Checkins`, verify one row was created with a 64-character hashed `Device ID` and no email column.
15. In `Attendance Dashboard`, verify the student is marked `P` and no email was added.
16. Rescan from the same browser and confirm the already-submitted state appears.
17. Select **Club Attendance > Close Current Session**.
18. Confirm a previously opened form can no longer submit.

Decode one generated QR and verify that its hostname is the student hostname and its parameters are only `session`, `access`, and `expires`. It must not contain `script.google.com`, `authuser`, GitHub Pages, or `qr.html`.

Repeat the scan while multiple Google accounts are signed in on the phone. The result must be identical because the student browser never opens Google.

### Step 14: Complete production acceptance

Run every applicable item in [`TESTING.md`](TESTING.md), including mobile layout, expiry, tampering, duplicate rolls, same-device blocking, registration approval, transient failures, simultaneous submissions, legacy URL removal, and multi-account access.

Do not use the system for a live meeting until:

- The Apps Script status route is anonymously reachable and is understood to be a routing check only.
- The production Vercel deployment has both environment variables.
- `Student Web App URL` contains the stable student origin.
- A fresh QR reaches the roll-entry screen, proving the Vercel proxy can read the configured Sheet.
- A real phone completes an end-to-end check-in.
- A decoded QR contains no Google or legacy redirect hostname.
- Administrators know how to close a session and recover the QR dialog.
- A backup and rollback plan exists.

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

Only trusted administrators should be able to edit `Settings`. QR generation intentionally trusts the configured custom student origin after validating that it is a root HTTPS domain and not a known Google application host.

The configured `Time zone`, `appsscript.json` `timeZone`, and the Google Sheet time zone under **File > Settings** must match. The repository defaults to `Asia/Kolkata`. To use another zone, update all three locations, upload the manifest, and publish a new Apps Script version before creating sessions.

When registration approval is enabled, the first check-in is recorded and the new `Students` row is marked Pending. An administrator approves future check-ins by changing that row's `Status` to `Active`. Until then, later scans show an approval-pending message.

### Server settings

| Location | Name | Visibility |
| --- | --- | --- |
| Apps Script Script Properties | `SPREADSHEET_ID` | Generated by workbook setup, server only |
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

### Official college email

First-time registration requires an email whose local part is the normalized roll number in lowercase:

```text
Roll:  CB.SC.U4CYS25048
Email: cb.sc.u4cys25048@cb.students.amrita.edu
```

The accepted value is exactly:

```text
<lowercase-roll-number>@cb.students.amrita.edu
```

An address with another roll number, another domain, extra characters, or an alias is rejected. The server derives the expected address from the validated roll number instead of trusting browser validation.

The email is stored only in the `Students` sheet's `Official Email` column. It is intentionally excluded from `Attendance Dashboard` and `Checkins`. This format check does not prove that the student controls the mailbox; administrators should use their normal identity or approval process when proof is required.

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
| `Setup / Initialise Workbook` | Creates sheets and appends missing configuration; verify ordered headers afterward |

### Before each meeting

1. Open the production Sheet with the administrator account.
2. Open `Settings` and confirm `Student Web App URL` still matches the production Vercel/custom origin.
3. Open the production student URL directly and confirm the page loads. This checks static hosting only, not the API or Sheet.
4. Inspect `Sessions` for a stale row whose `Status` is `Open`.
5. Close stale sessions with **Club Attendance > Close Current Session**. Repeat the command if more than one stale Open row exists.
6. Confirm the device used to display the QR has a stable network connection.
7. Tell students to scan with their normal browser rather than a private tab or scanner WebView.

Do not edit a session's `Status` directly while check-ins may be in flight. The menu action coordinates closure with attendance writes through `LockService`.

### Open and display attendance

1. Select **Club Attendance > Create New Attendance Session**.
2. Enter a title that uniquely identifies the meeting.
3. Enter the attendance duration in minutes.
4. Wait for the QR dialog to show **Session live**.
5. Scan one fresh QR on an administrator test phone and stop at the roll-entry screen without submitting. This verifies the proxy, secret, Apps Script deployment, and Sheet connection without creating a check-in.
6. Project or display the live dialog without photographing or distributing it.
7. Keep the dialog open while attendance is being collected. Its QR rotates automatically.
8. If the dialog is closed accidentally, select **Club Attendance > Show Current QR Code**.
9. If the dialog shows **Reconnecting**, wait for automatic recovery or reopen it after checking the administrator connection.

### Monitor submissions

1. Watch `Checkins` for new rows.
2. Confirm `Attendance Dashboard` changes the correct session marker from `A` to `P`.
3. Do not sort, rename, or reorder standard columns while attendance is open.
4. Investigate repeated errors before asking students to retry many times.
5. If Vercel reports rate limiting, wait for the one-minute window and inspect whether a firewall rule is too restrictive for the shared campus IP.

### Approve a pending registration

When `New registrations require approval` is `TRUE`, the student's first attendance is recorded but future sessions require approval:

1. Open `Students`.
2. Find the row by normalized roll number.
3. Verify the submitted full name and official email through the club's normal identity process.
4. Change `Status` from `Pending` to `Active` to approve the student.
5. Use `Inactive` only when future attendance must be blocked.
6. Do not change the roll-number format or standard column names.

### Close attendance

1. Select **Club Attendance > Close Current Session** as soon as the attendance window ends.
2. Confirm the success alert appears.
3. Verify the latest row in `Sessions` now has `Status` set to `Closed`.
4. Confirm a previously open student form can no longer submit.
5. Close the QR dialog and stop displaying it.
6. Review the dashboard and check-in count before treating the session as final.

### Reset test data

Use **Reset / Clear All Sessions** only in a disposable or backed-up workbook. The action deletes all session history, check-ins, and dashboard session columns while retaining students and settings.

A copied Sheet is a data snapshot, not an automatic production replacement. Normal recovery copies required data back into the original workbook so the existing Apps Script project, Script Properties, deployment URL, and Vercel configuration remain valid. Promoting the copied workbook itself requires repeating the Clasp binding, setup, Script Properties, Apps Script deployment, Vercel URL update, and verification steps.

1. Select **File > Make a copy** and verify the backup opens.
2. Confirm no attendance session is active.
3. Select **Club Attendance > Reset / Clear All Sessions**.
4. Read the warning and select **Yes** only when the target workbook is correct.
5. Verify `Sessions` and `Checkins` retain headers but contain no data rows.
6. Verify dashboard student columns remain and session columns are removed.

The reset action cannot be undone. The lock prevents concurrent writes, but Google Sheets does not provide multi-range transactions. If reset fails partway through, stop using that workbook and recover from the backup or a known state.

## Updating

### Step 1: Prepare and test the update

1. Close active attendance sessions.
2. Make a copy of the production Sheet.
3. Record the current Apps Script deployment version and Vercel production deployment.
4. Pull the target branch and install its locked dependencies:

```bash
git pull
npm ci
npm test
npm audit
```

Do not deploy unless tests pass and the audit result is understood.

Treat the Sheet copy as a data backup. Restoring into the original workbook preserves its bound Apps Script project and deployment. Promoting the copy as production requires a new Clasp binding, Script Properties, Apps Script deployment, Vercel environment update, and redeployment.

### Controlled Gender schema migration

Gender is stored only in `Students` with the exact allowed values `Male` or `Female`. Legacy rows remain blank until the student supplies the value at a later attendance. The system never infers Gender and never copies it into `Checkins` or `Attendance Dashboard`.

Run this procedure with all sessions closed and manual Sheet edits frozen:

1. Upload the Apps Script source to the bound project, but do not publish the new web-app version yet.
2. Refresh the Sheet and select **Club Attendance > Check Gender Schema (Dry Run)**.
3. Record the reported row count, column count, proposed column, blank/valid/unexpected counts, duplicate-key count, and preservation digest. The dry run performs no writes and creates no copy.
4. Stop if the report is blocked. Resolve renamed, duplicate, blank, formula-based, or noncanonical headers; duplicate roll keys; or unexpected existing Gender values manually on a copy first.
5. Select **Club Attendance > Apply Gender Schema Upgrade** and confirm the operation.
6. Record the verified backup spreadsheet ID and URL. The apply path uses the attendance script lock, verifies the backup, revalidates the original, writes only the new `Gender` header cell, flushes, and compares the legacy range digest and dimensions.
7. Run the dry run again. It must report `already_applied`, one canonical `Gender` header, unchanged row count, and no unexpected values.
8. Compare `Students` keys/order/formulas, all `Attendance Dashboard` session headers and values, `Sessions`, `Checkins`, and the current meeting counts against the pre-migration copy.

The operation is idempotent: a second apply creates no backup and performs no write. Do not populate legacy Gender cells in bulk.

Rollback is operator-controlled. If verification fails, close attendance, retain the original and generated backup, compare the reported digests and exact affected cells, and obtain explicit approval before restoring. If the only verified change is the blank `Gender` header, clear only that cell. If legacy content differs, restore the affected cells from the verified backup into the original workbook; do not automatically promote the copied workbook because its binding, Script Properties, deployment URL, and Vercel configuration differ.

### Gender-aware attendance and Shuffle

- Existing students with a blank Gender see one required `Male` then `Female` choice before confirmation. A valid stored value skips the prompt on future attendance.
- New registrations require the same choice. The Apps Script server re-reads and writes the student row by normalized roll under `LockService`; it never overwrites a nonblank valid value.
- If Gender saves but a later attendance write fails, attendance is not reported as confirmed. Retrying skips Gender and safely retries attendance through existing duplicate enforcement.
- Shuffle participants are latest-session `P` plus only the latest-session absent students explicitly selected by an administrator. Selection never changes attendance markers.
- Group count is exactly `ceil(participants / preferred team size)`. New-member status, registration date, earlier attendance, department distribution, and Female availability never change it.
- The seeded construction creates balanced capacities no larger than the preferred size, places one Female participant in as many teams as mathematically possible, then fills the smallest available teams with seeded tie-breaking.
- Shuffle reads only stored valid `Official Email` values. Administrator output includes a College Email column and deduplicated team mailing list; missing or invalid addresses produce warnings without removing participants.
- Output reports team capacities, size range, Female coverage, source totals, missing-email count, warnings, and the PRNG seed without exposing per-person Gender. Reproduction requires unchanged participant metadata and the same seed.

### Step 2: Upload Apps Script changes

Check the upload boundary and push the source:

```bash
npx clasp status
npx clasp push --force
```

Then publish the uploaded source:

1. Open the bound Apps Script project.
2. Select **Deploy > Manage deployments**.
3. Select the pencil icon for the production web app.
4. Under **Version**, choose **New version**.
5. Add a short deployment description.
6. Confirm **Execute as: Me** and **Who has access: Anyone**.
7. Select **Deploy**.
8. Confirm the `/exec` URL still returns the status JSON, remembering that this checks routing rather than Sheet access.

`clasp push` alone does not update a versioned web deployment. Reusing the existing deployment keeps the `/exec` URL stable. If the URL changes because a new deployment was created, update `APPS_SCRIPT_URL` in Vercel and redeploy.

### Step 3: Deploy Vercel changes

1. Merge or push the approved commit to the Vercel production branch.
2. Open the Vercel project and watch the new production deployment.
3. Confirm deployment status is **Ready**.
4. Confirm both server environment variables remain configured for Production.
5. Open the stable student origin and confirm the interface loads.
6. Verify security or firewall rules still cover `/api/attendance`.

If automatic Git deployments are disabled, open **Deployments**, select the deployment built from the approved commit, and promote or redeploy it to Production.

### Step 4: Apply workbook upgrades

1. Refresh the Google Sheet.
2. Select **Club Attendance > Setup / Initialise Workbook** once.
3. Confirm the expected sheets, headers, settings, and existing records remain present.
4. Confirm `Student Web App URL` was not replaced.

Setup also neutralizes formula-like values left in the historical `User Agent` column by older deployments.

### Step 5: Verify the release

1. Create a short, clearly labeled validation session.
2. Scan the live QR from a real phone.
3. Confirm the hostname is still the production student origin.
4. Reach the roll-entry screen. This non-mutating step verifies Vercel, the shared secret, Apps Script, and Sheet access.
5. Complete a full check-in only in staging or when an approved production validation record may be retained.
6. If a check-in was completed, verify the Sheet write and dashboard marker.
7. Close the session.
8. Complete any release-specific items in [`TESTING.md`](TESTING.md).

Do not run the global reset command to remove one validation session. Production validation sessions and dashboard columns should remain as labeled audit records unless an administrator performs a separately reviewed data correction.

### Rotate the API secret

Secret rotation causes a brief mismatch unless a dual-secret service is introduced, so use a maintenance window:

1. Close active sessions.
2. Generate a new secret using the command from deployment Step 7.
3. Replace `VERCEL_API_SECRET` in Apps Script Script Properties.
4. Replace `APPS_SCRIPT_API_SECRET` in every Vercel environment that targets this Apps Script deployment, including Production, Preview, or custom environments.
5. Redeploy each affected Vercel environment so its function receives the new value.
6. Confirm the Apps Script status route.
7. Create a short, clearly labeled validation session.
8. Scan its fresh QR until the roll-entry screen appears.
9. Close the validation session.
10. Remove the temporary local copy of the secret.

Never place the old or new value in Git while rotating it.

### Rotate the QR signing secret after an incident

Routine QR-secret rotation is unnecessary because links expire after 25 seconds, but rotate it if `QR_SIGNING_SECRET` may have been exposed:

1. Close every open attendance session.
2. Wait at least five minutes for previously issued access grants to expire, or keep all affected sessions closed permanently.
3. Open Apps Script **Project Settings > Script Properties**.
4. Delete only `QR_SIGNING_SECRET`. Do not delete `SPREADSHEET_ID` or `VERCEL_API_SECRET`.
5. Create a new test attendance session and open its QR dialog. Apps Script generates a new signing secret automatically.
6. Confirm `QR_SIGNING_SECRET` reappears in Script Properties.
7. Scan a newly generated QR and verify it reaches the roll-entry screen.
8. Close the new validation session.
9. Keep all sessions that displayed QR codes under the compromised secret closed.

### Roll back a failed release

1. Close any session created by the failed release.
2. Decide whether environment variables changed in the failed release.
3. For a code-only Vercel rollback, use Vercel's rollback action on the last known-good production deployment.
4. If secrets or `APPS_SCRIPT_URL` changed, do not blindly restore a deployment containing stale environment values. Redeploy the known-good commit with the current correct variables instead.
5. In Apps Script **Deploy > Manage deployments**, edit the production deployment and select the previous known-good version.
6. Deploy that Apps Script version.
7. Restore data into the original Sheet only if the failed release corrupted data; do not overwrite valid attendance unnecessarily.
8. If the copied Sheet must become production, repeat the binding and deployment process and update Vercel to its new Apps Script `/exec` URL.
9. Verify the static Apps Script status route.
10. Create a short rollback-validation session and scan its QR until the roll-entry screen appears.
11. Close the rollback-validation session.
12. After a Vercel instant rollback, use **Undo Rollback** when the repaired deployment is ready, or explicitly promote that repaired deployment to Production. A normal Git build alone does not leave rollback mode or restore automatic production-domain assignment.
13. Record the rollback, environment state, and failed commit for later investigation.

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
5. `SPREADSHEET_ID` exists in Apps Script Script Properties and belongs to the production workbook.
6. The Apps Script `/exec` URL returns static status JSON from a signed-out client.
7. A fresh QR reaches the roll-entry screen; this is the check that proves Sheet access and proxy authentication.

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

The first ten `Checkins` headers must be exactly `Checkin ID`, `Timestamp`, `Session ID`, `Session Date`, `Roll Number`, `Full Name`, `Result`, `Source`, `User Agent`, and `Device ID` in that order. Setup can append a missing final `Device ID`, but a renamed, deleted, duplicated, or reordered earlier column requires manual restoration before attendance can resume.

### Apps Script cannot find the attendance workbook

1. Open the original bound Google Sheet.
2. Select **Club Attendance > Setup / Initialise Workbook**.
3. Open Apps Script **Project Settings > Script Properties**.
4. Confirm `SPREADSHEET_ID` now exists.
5. Do not copy the ID from a backup workbook unless that workbook is being fully promoted with a new Apps Script and Vercel deployment.
6. Publish a new Apps Script version if the runtime code was also updated.
7. Scan a fresh QR and confirm the roll-entry screen appears.

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

The Sheet contains student names, roll numbers, official college emails, and attendance records. Restrict Sheet edit access, avoid exporting logs unnecessarily, set an appropriate retention policy, and close sessions promptly. Signed QR parameters may appear in Vercel request metadata and expire quickly; restrict observability access and retention. Never commit `.clasp.json`, production environment files, API secrets, or exported student data.
