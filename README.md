# B-RIG Club Attendance System 🚀

A futuristic, highly animated, and beautifully designed web-based attendance system built entirely on Google Apps Script and Google Sheets. Designed with a premium Apple-like aesthetic, glassmorphism UI, and custom 3D coin physics to gamify student check-ins.

---

## 🌟 Features
* **Cinematic UI/UX:** Built with pure HTML/CSS/JS, featuring glassmorphism, fluid micro-animations, and a responsive mobile-first layout.
* **Dopamine-Filled Check-ins:** Successfully scanning a QR code triggers a massive 3D parallax explosion and continuous rain of club logos using device gyroscope physics.
* **Dynamic QR Generation:** Admins can generate secure, session-specific QR codes directly from the dashboard.
* **100% Serverless & Free:** Uses Google Sheets as the backend database. No servers to maintain, no hosting costs. Infinite scaling.
* **Real-time Sync:** Check-ins instantly update the Google Sheet dashboard.

---

## 🛠️ Tech Stack
* **Frontend:** Vanilla HTML, CSS, JavaScript
* **Backend:** Google Apps Script (Node.js environment)
* **Database:** Google Sheets
* **Deployment:** Google Clasp CLI

---

## 📥 Complete Installation Guide

Follow these steps to deploy this exact system for your own club or organization from scratch.

### Step 1: Prepare Your Database
1. Create a brand new **Google Sheet**.
2. At the bottom of the spreadsheet, create exactly **5 tabs** and name them exactly as follows (case-sensitive):
   - `Settings`
   - `Students`
   - `Sessions`
   - `Checkins`
   - `Dashboard`
3. In the **`Settings`** tab, fill out cell `A1` with `Time zone` and `B1` with `Asia/Kolkata`.
4. In cell `A2` type `Club Name` and in `B2` type `B-RIG` (or your club's name).

### Step 2: Configure Google Apps Script
1. In your Google Sheet, click **Extensions > Apps Script** in the top menu.
2. A new coding tab will open. On the left sidebar, click the **Gear Icon (Project Settings)**.
3. Scroll down and copy the **Script ID** (a long string of characters).

### Step 3: Link Code to Your Spreadsheet
1. Clone or download this repository to your local computer.
2. Open the downloaded folder and locate the `.clasp.json` file.
3. Open `.clasp.json` in a text editor (like Notepad or VSCode).
4. Replace the existing `scriptId` value with your new **Script ID** that you copied in Step 2. Save the file.

### Step 4: Deploy the Code
1. Open your terminal (Command Prompt or PowerShell) inside the project folder.
2. Ensure you have Node.js installed, then install the Google Clasp CLI:
   ```bash
   npm install -g @google/clasp
   ```
3. Log in to your Google Account (this will open a browser window):
   ```bash
   clasp login
   ```
4. Push the code to your Apps Script environment:
   ```bash
   clasp push -f
   ```

### Step 5: Publish the Web App
1. Go back to your Apps Script browser tab and refresh the page. You should now see all the files loaded.
2. In the top right corner, click **Deploy > New deployment**.
3. Click the gear icon next to "Select type" and choose **Web App**.
4. Configure as follows:
   * **Execute as:** `Me`
   * **Who has access:** `Anyone`
5. Click **Deploy**. (Google will ask you to authorize permissions—click Advanced -> Go to script).
6. Copy the **Web App URL**. This is the live link you will use to manage attendance and scan QR codes!

---
*Built with ❤️ for B-RIG.*
