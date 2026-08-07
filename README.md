# B-RIG Club Attendance System

A serverless QR-based attendance system for clubs and student organizations. The application runs on Google Apps Script, stores its data in Google Sheets, and provides a responsive browser-based check-in experience without requiring a separate server or database.

## Features

- Secure, session-specific QR codes for attendance
- Automatically rotating QR links with signed short-lived access
- Configurable attendance windows
- New-student registration during check-in
- Duplicate, expired, invalid, and closed-session protection
- Institutional roll-number validation for programme, department, joining year, and roll sequence
- One attendance submission per browser device per session to discourage proxy attendance
- Live attendance records in Google Sheets
- Automatic present, absent, and pre-registration markers
- Concurrency protection for simultaneous check-ins
- Responsive interface with animated success feedback
- Administrative controls from a custom Google Sheets menu

## Technology

| Component | Technology |
| --- | --- |
| Frontend | HTML, CSS, and vanilla JavaScript |
| Backend | Google Apps Script (V8 runtime) |
| Database | Google Sheets |
| Deployment | Google Clasp CLI |
| Hosting | Google Apps Script Web App |

## How It Works

1. An administrator creates an attendance session from the Google Sheet.
2. The system generates a unique session token and QR code.
3. Students scan the QR code and enter their roll number.
4. The system validates the session, roll-number structure, student, and browser device before accepting attendance.
5. Attendance is written to the dashboard and check-in log immediately.

## Requirements

Before installation, you need:

- A Google account with permission to create Google Sheets and Apps Script projects
- [Node.js](https://nodejs.org/) 18 or newer, including `npm`
- [Git](https://git-scm.com/downloads)
- A modern web browser

The repository includes Clasp as a development dependency, so a global Clasp installation is not required.

> **Important:** Google does not support simultaneous multi-login for Apps Script web apps. Use a dedicated browser profile for administration and sign in to only one Google account in that profile. The account used for Google Sheets, Apps Script, and `npx clasp login` must be the same administrator account. Students who have multiple Google accounts signed in should open the QR link in an incognito/private window or sign out of their other accounts first.

## Windows Installation

Use **PowerShell** for the commands in this section.

### 1. Install and verify the required tools

Install the current Node.js LTS release from [nodejs.org](https://nodejs.org/) and Git from [git-scm.com](https://git-scm.com/download/win). Accept the default installer options, close PowerShell, reopen it, and verify both tools:

```powershell
node --version
npm --version
git --version
```

Each command should print a version number. If a command is not recognized, restart Windows or add the application to your `PATH`.

### 2. Download the project and install dependencies

Choose a folder for the project, then run:

```powershell
git clone https://github.com/ROHIT-JR/B-RIG_Club_Attendance-.git B-RIG_Club_Attendance
Set-Location B-RIG_Club_Attendance
npm ci
```

`npm ci` installs the exact Clasp version recorded in `package-lock.json`.

### 3. Create and connect the Google Apps Script project

Open [Google Sheets](https://sheets.google.com), create a blank spreadsheet, and give it a recognizable name such as **B-RIG Club Attendance**. In the spreadsheet, select **Extensions > Apps Script**.

In the Apps Script editor, select **Project Settings** from the left sidebar and copy the **Script ID**. Return to PowerShell and create the local Clasp configuration, replacing `PASTE_YOUR_SCRIPT_ID_HERE` with the copied value:

```powershell
'{"scriptId":"PASTE_YOUR_SCRIPT_ID_HERE","rootDir":"."}' | Set-Content -Encoding ASCII .clasp.json
```

Do not share or commit `.clasp.json`; it identifies your Apps Script project and is already excluded by `.gitignore`.

### 4. Sign in, upload the code, and initialize the workbook

Run the following commands:

```powershell
npx clasp login
npx clasp push --force
```

Sign in with the same Google account that owns the spreadsheet and approve the requested access. After the upload finishes, return to the spreadsheet and refresh the page. Open **Club Attendance > Setup / Initialise Workbook** and approve the Google authorization prompt if it appears.

Use a browser profile containing only this administrator account. If Google displays an account-selection or authorization error, sign out of the other accounts before continuing.

The setup command creates and configures `Attendance Dashboard`, `Students`, `Sessions`, `Checkins`, and `Settings`. Do not rename these sheets.

### 5. Deploy, configure, and test the web app

In the Apps Script editor, select **Deploy > New deployment**, choose **Web app**, and use these settings:

- **Execute as:** Me
- **Who has access:** Anyone

Select **Deploy**, complete authorization, and copy the Web App URL ending in `/exec`. In the spreadsheet, open the `Settings` sheet and replace `Paste your web app URL here` beside `Public Web App URL` with that URL. Update `Club Name`, `Time zone`, and other settings if needed.

Refresh the spreadsheet, select **Club Attendance > Create New Attendance Session**, enter a title and duration, and scan the generated QR code to confirm that the check-in page opens.

## macOS Installation

Use **Terminal** for the commands in this section.

### 1. Install and verify the required tools

Install Apple's command-line tools, which include Git:

```bash
xcode-select --install
```

Install the current Node.js LTS release from [nodejs.org](https://nodejs.org/). Open a new Terminal window after installation, then verify the tools:

```bash
node --version
npm --version
git --version
```

Each command should print a version number.

### 2. Download the project and install dependencies

Run:

```bash
git clone https://github.com/ROHIT-JR/B-RIG_Club_Attendance-.git B-RIG_Club_Attendance
cd B-RIG_Club_Attendance
npm ci
```

`npm ci` installs the exact Clasp version recorded in `package-lock.json`.

### 3. Create and connect the Google Apps Script project

Open [Google Sheets](https://sheets.google.com), create a blank spreadsheet, and name it **B-RIG Club Attendance**. Select **Extensions > Apps Script**, open **Project Settings** from the Apps Script sidebar, and copy the **Script ID**.

Return to Terminal and create the Clasp configuration, replacing `PASTE_YOUR_SCRIPT_ID_HERE` with the copied value:

```bash
printf '%s\n' '{"scriptId":"PASTE_YOUR_SCRIPT_ID_HERE","rootDir":"."}' > .clasp.json
```

Do not share or commit `.clasp.json`; it identifies your Apps Script project and is already excluded by `.gitignore`.

### 4. Sign in, upload the code, and initialize the workbook

Run:

```bash
npx clasp login
npx clasp push --force
```

Sign in with the Google account that owns the spreadsheet and approve access. Return to the spreadsheet after the upload completes and refresh the page. Select **Club Attendance > Setup / Initialise Workbook** and approve the Google authorization prompt if requested.

Use a browser profile containing only this administrator account. If Google displays an account-selection or authorization error, sign out of the other accounts before continuing.

The setup command creates and configures `Attendance Dashboard`, `Students`, `Sessions`, `Checkins`, and `Settings`. Do not rename these sheets.

### 5. Deploy, configure, and test the web app

In the Apps Script editor, select **Deploy > New deployment**, choose **Web app**, and configure:

- **Execute as:** Me
- **Who has access:** Anyone

Select **Deploy**, authorize the application, and copy the Web App URL ending in `/exec`. In the spreadsheet's `Settings` sheet, replace `Paste your web app URL here` beside `Public Web App URL` with the copied URL. Adjust `Club Name`, `Time zone`, and the remaining settings when required.

Refresh the spreadsheet, select **Club Attendance > Create New Attendance Session**, provide a title and duration, and scan the QR code to verify the public check-in page.

## Linux Installation

Use your distribution's terminal for the commands in this section. The examples below cover Ubuntu/Debian, Fedora, and Arch Linux.

### 1. Install and verify the required tools

Install Node.js, npm, and Git with the command for your distribution:

**Ubuntu or Debian:**

```bash
sudo apt update
sudo apt install -y nodejs npm git
```

**Fedora:**

```bash
sudo dnf install -y nodejs npm git
```

**Arch Linux:**

```bash
sudo pacman -S --needed nodejs npm git
```

Verify that Node.js 18 or newer is installed:

```bash
node --version
npm --version
git --version
```

If your distribution provides an older Node.js release, install the current LTS release using the instructions at [nodejs.org](https://nodejs.org/).

### 2. Download the project and install dependencies

Run:

```bash
git clone https://github.com/ROHIT-JR/B-RIG_Club_Attendance-.git B-RIG_Club_Attendance
cd B-RIG_Club_Attendance
npm ci
```

`npm ci` installs the exact Clasp version recorded in `package-lock.json`.

### 3. Create and connect the Google Apps Script project

Open [Google Sheets](https://sheets.google.com), create a blank spreadsheet, and name it **B-RIG Club Attendance**. Select **Extensions > Apps Script**, open **Project Settings** from the left sidebar, and copy the **Script ID**.

Return to the terminal and create the Clasp configuration, replacing `PASTE_YOUR_SCRIPT_ID_HERE` with the copied value:

```bash
printf '%s\n' '{"scriptId":"PASTE_YOUR_SCRIPT_ID_HERE","rootDir":"."}' > .clasp.json
```

Do not share or commit `.clasp.json`; it identifies your Apps Script project and is already excluded by `.gitignore`.

### 4. Sign in, upload the code, and initialize the workbook

Run:

```bash
npx clasp login
npx clasp push --force
```

Clasp opens a browser for Google sign-in. If no browser opens, copy the URL printed in the terminal into a browser manually. Use the account that owns the spreadsheet and approve access.

Use a browser profile containing only this administrator account. If Google displays an account-selection or authorization error, sign out of the other accounts before continuing.

After the upload completes, return to the spreadsheet and refresh it. Select **Club Attendance > Setup / Initialise Workbook** and approve the Google authorization prompt if requested. The command creates and configures `Attendance Dashboard`, `Students`, `Sessions`, `Checkins`, and `Settings`. Do not rename these sheets.

### 5. Deploy, configure, and test the web app

In the Apps Script editor, select **Deploy > New deployment**, choose **Web app**, and configure:

- **Execute as:** Me
- **Who has access:** Anyone

Select **Deploy**, authorize the application, and copy the Web App URL ending in `/exec`. In the spreadsheet's `Settings` sheet, replace `Paste your web app URL here` beside `Public Web App URL` with the copied URL. Adjust `Club Name`, `Time zone`, and other settings as needed.

Refresh the spreadsheet, select **Club Attendance > Create New Attendance Session**, provide a title and duration, and scan the QR code to verify the check-in page.

## Configuration

The `Settings` sheet is created automatically during initialization.

| Setting | Purpose | Default |
| --- | --- | --- |
| `Club Name` | Name displayed on the check-in page | `Student Club` |
| `Public Web App URL` | Deployed `/exec` URL used to build QR links | Must be supplied |
| `New registrations require approval` | Creates new students as Pending when `TRUE` | `FALSE` |
| `Default attendance window in minutes` | Default duration of a new session | `60` |
| `Time zone` | Time zone used for session dates | `Asia/Kolkata` |

Use a valid [IANA time zone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones), such as `Asia/Kolkata`, `Europe/London`, or `America/New_York`.

## Roll Number Format

Only institutional roll numbers matching this structure are accepted:

```text
CB.SC.U4CYS25048
|______||_||_||_|
Programme Dept Year Roll
```

| Segment | Rule | Example |
| --- | --- | --- |
| Programme | Fixed prefix | `CB.SC.U4` |
| Department | Exactly three letters | `CYS`, `CSE`, `ECE` |
| Joining year | Exactly two digits | `25` |
| Roll sequence | Exactly three digits | `048` |

Input is normalized to uppercase. For example, `cb.sc.u4cys25048` becomes `CB.SC.U4CYS25048`. Values such as `CS21045`, `CB.SC.U4CYS2548`, or department codes that are not exactly three letters are rejected by both the browser and server.

## Device-Based Proxy Protection

On first use, the check-in page creates a random identifier in browser storage. The server hashes that identifier and records only the hash in the `Device ID` column of the `Checkins` sheet. During a session:

- The same roll number cannot check in twice, even from another device.
- The same browser device cannot submit attendance for a second roll number.
- Device checks and attendance writes run under the same server lock to prevent simultaneous requests bypassing the restriction.

This is a practical deterrent, not proof of physical-device identity. Web browsers do not expose a permanent phone identifier. A determined user may bypass browser-based controls by clearing site data, changing browsers, or using another device. Stronger identity assurance requires institutional sign-in, a trusted mobile application, or administrator verification.

The application now also saves a local receipt for every successful or device-blocked session. Rescanning in the same persistent browser goes directly to the already-submitted state instead of reopening the attendance form. Server-side checks remain authoritative and run under a lock.

Students should use their phone's main Chrome, Safari, Firefox, or Samsung Internet browser. QR scanner WebViews, social-media in-app browsers, private tabs, and browsers configured to erase site data may create a new storage partition on every scan. A website cannot reliably recognize those partitions as the same physical phone.

After upgrading an existing installation, run **Club Attendance > Setup / Initialise Workbook** once. This adds the `Device ID` header without deleting existing attendance data. Then publish a new deployment version.

## Link-Sharing Protection

The administrator dashboard no longer displays a permanent attendance URL. Instead, it shows a signed QR code that refreshes every 10 seconds. Each generated link expires after 25 seconds.

Only an authorized spreadsheet dialog receives the temporary credential needed to request fresh QR links. Student web pages cannot call the QR generator to renew an expired shared link. Signing and grant-validation helpers are private Apps Script functions and are not exposed through `google.script.run`.

When a student scans a valid QR code, the server issues a temporary five-minute access grant bound to that browser's device identifier. The grant is required for roll-number lookup and final attendance submission. As a result:

- Opening the permanent Web App URL without a live QR signature is rejected.
- Calling the rotating QR endpoint without the administrator dialog credential is rejected.
- Removing or changing the QR signature or expiration timestamp is rejected.
- Screenshots and copied QR links stop working shortly after generation.
- A grant copied from one browser cannot be used from a different browser device.
- Students who have already scanned can complete the form after the visible QR rotates, provided they finish within five minutes.

No browser-based system can make a URL physically impossible to photograph or transmit. Someone who shares a live QR image immediately may still allow another person to scan it before its short expiration. Fully preventing real-time remote sharing requires an additional presence signal such as administrator verification, institutional authentication, a managed campus network, or location checking. The rotating signed QR substantially reduces the useful sharing window without collecting precise location data.

## Daily Use

The **Club Attendance** menu appears whenever an administrator opens the connected spreadsheet.

| Menu command | Purpose |
| --- | --- |
| `Create New Attendance Session` | Opens a timed session and displays its QR code |
| `Show Current QR Code` | Reopens the QR code for the latest open session |
| `Close Current Session` | Stops further check-ins for the active session |
| `Reset / Clear All Sessions` | Deletes session and check-in history while retaining students |
| `Setup / Initialise Workbook` | Creates missing sheets, headers, and default settings |

The reset action cannot be undone. Make a spreadsheet copy before clearing production data.

### Student access with multiple Google accounts

Google officially states that simultaneous multi-login is not supported for Apps Script web apps. A student signed in to two or more Google accounts may see an account-selection, authorization, permission, or page-loading error before the B-RIG application itself opens.

As a practical workaround, every generated B-RIG QR URL includes `authuser=0`. This tells Google to use the browser's primary signed-in account instead of trying to resolve several active accounts. The web app is deployed for anonymous access and executes as the administrator, so the selected student account is not used to access the attendance spreadsheet.

Google does not guarantee that account-slot selection resolves every multi-login or Workspace-policy combination. If Google's page still appears before B-RIG loads, ask the student to use either supported fallback:

1. Open an incognito/private browsing window, scan or paste the QR link there, and use only the intended Google account if sign-in is requested.
2. Sign out of all Google accounts, sign back in to only one account, and open the QR link again.

See Google's official [Apps Script troubleshooting guidance for multiple accounts](https://developers.google.com/apps-script/guides/support/troubleshooting#issues_with_multiple_google_accounts).

## Updating an Existing Installation

Pull the latest code and upload it:

```bash
git pull
npm ci
npx clasp push --force
```

Then open **Deploy > Manage deployments** in Apps Script, edit the active deployment, choose **New version**, and deploy it. Existing spreadsheet data is preserved.

## Troubleshooting

### `clasp` reports that the Apps Script API is disabled

Open [Apps Script user settings](https://script.google.com/home/usersettings), enable the **Google Apps Script API**, wait a few minutes, and run `npx clasp push --force` again.

### `User has not enabled the Apps Script API`

Confirm that the API was enabled for the same Google account used by `npx clasp login`. Run `npx clasp logout`, then `npx clasp login` if the wrong account was selected.

### An administrator sees an account-selection, authorization, or permission error

This commonly happens when the browser profile contains multiple signed-in Google accounts. Google Sheets may open under one account while Clasp or Apps Script authorizes another.

1. Close the Google Sheet and Apps Script tabs.
2. Sign out of every Google account in the browser profile.
3. Sign in only to the administrator account that owns the spreadsheet.
4. Reset Clasp authentication:

```bash
npx clasp logout
npx clasp login
```

5. Reopen the spreadsheet from that account and retry the upload or deployment.

For ongoing administration, keep a dedicated browser profile with only the B-RIG administrator account signed in.

### A student cannot open the QR check-in link

If the student is signed in to multiple Google accounts, the failure may occur on Google's page before B-RIG loads. Ask the student to open the QR link in an incognito/private window. If that does not work, they should sign out of all Google accounts, sign in to only one account, and retry the same link.

This is a [documented Google Apps Script multi-login limitation](https://developers.google.com/apps-script/guides/support/troubleshooting#issues_with_multiple_google_accounts), not an attendance-session validation error. Also confirm that the session is still open and that the deployed Web App URL ends in `/exec`.

### Google Drive says "Sorry, unable to open the file at present"

This page is generated by Google before B-RIG loads, so the application cannot replace it with a custom error. It means Google could not resolve or authorize the Apps Script deployment URL. Check the following in order:

1. Open **Apps Script > Deploy > Manage deployments** and confirm the web app deployment still exists.
2. Confirm **Execute as** is `Me` and **Who has access** is `Anyone`.
3. Copy the active deployment URL ending in `/exec` into `Settings > Public Web App URL`. Do not paste an Apps Script editor URL, Google Drive sharing URL, `/dev` test URL, or URL from a deleted deployment.
4. After uploading code, edit the active deployment, select **New version**, and deploy again. Merely running `clasp push` does not update a versioned web app.
5. Open the link in the phone's main Chrome, Safari, Firefox, or Samsung Internet browser instead of the QR scanner's embedded browser.
6. If several Google accounts are signed in, use a dedicated single-account browser profile. As a temporary access workaround, use a private window with only the intended account, but note that private storage weakens browser-device recognition after the window closes.

Generated QR links automatically include `authuser=0` to select the primary Google account. If that primary account is controlled by a school or company that blocks Apps Script, use a browser profile containing only an account that is permitted to access the deployment.

The server now refuses to generate a QR code unless `Public Web App URL` matches the standard production Apps Script `/exec` format. This catches malformed configuration but cannot detect a correctly shaped URL whose deployment was later deleted.

### The Club Attendance menu does not appear

Confirm that `npx clasp push --force` completed successfully, then refresh the Google Sheet. The menu is displayed in the spreadsheet, not in the Apps Script editor.

### The QR code says the Web App URL is missing

Copy the deployed URL ending in `/exec` into the `Public Web App URL` row of the `Settings` sheet. Do not use the deployment test URL ending in `/dev`.

### Students cannot open the check-in page

Edit the web app deployment and confirm that **Who has access** is set to **Anyone**. Some managed Google Workspace accounts prohibit public deployments; contact the Workspace administrator or deploy from an account that permits public web apps.

### Code changes are not visible in the live application

Running `npx clasp push --force` updates the Apps Script source but not an existing versioned web deployment. Create a new version under **Deploy > Manage deployments**.

## Verification

After installation, use the scenarios in [`TESTING.md`](TESTING.md) to verify roll-number validation, registration, device enforcement, duplicate detection, session expiry, closed sessions, and simultaneous scans.

## Project Structure

| File | Responsibility |
| --- | --- |
| `Code.js` | Menus, session management, web endpoint, and attendance workflow |
| `Config.js` | Sheet names, defaults, statuses, and shared configuration |
| `Database.js` | Google Sheets queries, device checks, and concurrency locking |
| `Index.html` | Student check-in page |
| `ClientScript.html` | Browser-side interaction and animation logic |
| `Styles.html` | Application styling |
| `AdminSidebar.html` | Administrative QR-code dialog |
| `appsscript.json` | Apps Script runtime, scopes, and web app settings |

## Security Notes

- Keep the Script ID and `.clasp.json` out of public commits.
- Treat the spreadsheet as sensitive because it contains student names, roll numbers, and attendance records.
- Grant spreadsheet edit access only to authorized administrators.
- Explain the one-attendance-per-browser-device policy to students before check-in.
- Use the generated session URLs rather than manually constructing or reusing old links.
- Close attendance sessions when check-in is complete.

---

Built for the B-RIG club.
