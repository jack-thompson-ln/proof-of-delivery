# FMF POD — Proof of Delivery

A self-contained, single-file web app for recording and managing delivery proof. Built for FMF and hosted on GitHub Pages with Supabase as the backend. Drivers access it from any mobile browser — no app install required.

---

## Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Supabase Setup](#supabase-setup)
- [Database Schema](#database-schema)
- [App Screens](#app-screens)
- [Admin Access](#admin-access)
- [Managing Drivers](#managing-drivers)
- [Managing Customers](#managing-customers)
- [Routes](#routes)
- [Offline Mode](#offline-mode)
- [Deployment](#deployment)
- [Making Changes](#making-changes)
- [Design System](#design-system)
- [Architecture Notes](#architecture-notes)
- [Troubleshooting](#troubleshooting)

---

## Overview

FMF POD gives drivers a quick way to record proof of delivery from their phone. Each delivery captures:

- Customer name (selected from the full customer list)
- Delivery photo (taken in-app or from gallery)
- Document number (invoice, suspended order, or pick note — optional)
- GPS location (captured automatically at submission, reverse-geocoded to an address)
- Timestamp (captured automatically at submission)
- Notes (free text, optional)

Admins can review history, view delivery maps, and analyse performance through PIN-protected screens. Everything runs from a single `index.html` file with no build tools, no frameworks, and no app store.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Single `index.html` — HTML, CSS, vanilla JavaScript |
| Hosting | GitHub Pages |
| Database | Supabase (PostgreSQL, accessed via REST API — no SDK) |
| File Storage | Supabase Storage |
| Offline Queue | Browser IndexedDB |
| Charts | Chart.js (loaded from CDN) |
| Maps | Leaflet.js + OpenStreetMap (loaded from CDN, no API key) |
| Geocoding | OpenStreetMap Nominatim (free, no API key) |

---

## Getting Started

The app is live at your GitHub Pages URL. Drivers navigate to that URL on their phone and log in. No installation needed.

To access the app as a driver:
1. Open the URL in any mobile browser (Safari on iOS, Chrome on Android)
2. Tap your name on the login screen
3. Enter your personal 4-digit PIN
4. The delivery form loads — you're ready to record drops

To access admin features (History, Analytics, Configuration):
1. From the login screen, tap the relevant icon in the top-right corner
2. Enter the admin PIN when prompted

---

## Supabase Setup

The app connects to a Supabase project. The connection details are hardcoded in the `config` block at the top of the `<script>` section in `index.html`:

```javascript
const config = {
  url:    'https://your-project.supabase.co',
  key:    'your-anon-key',
  bucket: 'delivery-photos',
  table:  'deliveries',
  pin:    '1122'            // Admin PIN — change this to whatever you like
};
```

| Setting | Where to find it |
|---|---|
| `url` | Supabase dashboard → Project Settings → API → Project URL |
| `key` | Supabase dashboard → Project Settings → API → Project API Keys → `anon` / `public` |
| `bucket` | The name of your Supabase Storage bucket |
| `table` | The name of your deliveries table (default: `deliveries`) |
| `pin` | Your chosen 4-digit admin PIN — stored only in this file |

> **Security note:** The `anon` key is safe to hardcode. It is public-facing by design and is restricted by Supabase's Row Level Security policies. Never hardcode your `service_role` key.

---

## Database Schema

Run the following SQL in your Supabase SQL Editor to create all required tables.

### `deliveries`

```sql
create table deliveries (
  id                uuid primary key default gen_random_uuid(),
  customer_name     text,
  driver_name       text,
  delivery_datetime timestamptz,
  photo_url         text,
  photo_filename    text,
  notes             text,
  doc_number        text,
  latitude          double precision,
  longitude         double precision,
  address           text,
  created_at        timestamptz default now()
);

-- Allow anonymous inserts and reads (internal tool — no user auth)
create policy "anon_insert" on deliveries for insert using (true) with check (true);
create policy "anon_select" on deliveries for select using (true);
```

> **If you already have a `deliveries` table** without the `doc_number` column, add it with:
> ```sql
> alter table deliveries add column if not exists doc_number text;
> ```

### `customers`

```sql
create table customers (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  active     boolean default true,
  created_at timestamptz default now()
);

create policy "anon_select" on customers for select using (true);
```

Customer names follow the convention `CODE - FULL NAME`, e.g. `A137 - MICHAEL GOMEZ`. The code portion (before the ` - `) is used in analytics.

To import customers in bulk, use the Supabase dashboard → Table Editor → Import CSV, or the SQL Editor with `COPY` or `INSERT` statements.

To deactivate a customer without deleting them:
```sql
update customers set active = false where name = 'A137 - MICHAEL GOMEZ';
```

### `drivers`

```sql
create table drivers (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  pin        text not null,
  active     boolean default true,
  created_at timestamptz default now()
);

create policy "anon_select" on drivers for select using (true);
```

### `routes`

```sql
create table routes (
  id           uuid primary key default gen_random_uuid(),
  driver_name  text not null,
  route_date   date not null,
  route_name   text,
  stops        jsonb not null default '[]',
  status       text not null default 'draft',
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz default now()
);

create policy "anon_all" on routes for all using (true) with check (true);
```

The `stops` column is a JSONB array of stop objects. Each stop can carry a customer name and an optional document number:

```json
[
  { "customer": "A137 - MICHAEL GOMEZ", "doc_number": "INV-4521" },
  { "customer": "B204 - SARAH JONES",   "doc_number": null }
]
```

### Storage bucket

In the Supabase dashboard, go to **Storage** and create a bucket named `delivery-photos`. Set it to **Public** so photo URLs are directly accessible without authentication.

---

## App Screens

### Login

The full-screen login overlay is the first thing all users see. Drivers select their name from a grid and enter their personal 4-digit PIN. On success, the session is saved to `localStorage` so the driver stays logged in across page refreshes. The logout button (→ icon in the header) clears the session.

Three admin icon buttons are visible in the top-right corner of the login screen. Each requires the admin PIN before opening.

### Delivery Form

After logging in, drivers see the delivery form. It has three steps:

**Step 1 — Customer**
Type to search the full customer list (3,400+ records). Multi-word search is supported — typing `michael north` returns customers whose name contains both words. Matching characters are highlighted in the dropdown. Once a customer is selected the form advances to step 2.

**Step 2 — Photo**
Tap the photo zone to open the camera or gallery. A preview is shown with a Retake option. The photo is saved as `YYYYMMDD_HHMMSS_CustomerName.jpg` in Supabase Storage.

**Step 3 — Submit**
The driver can optionally enter a document number (invoice, suspended order, or pick note) and any free-text notes. The Record Delivery button is only active once a customer and photo are both in place.

At the top of the form, the driver welcome strip shows:
- Driver name and login status
- A live clock pill (updates every second)
- A GPS pill (shows "Auto GPS / Captured at submission" before recording; updates to the actual address after)

When an active route is assigned for today, a route card appears above the welcome strip showing the stop list. Tapping an undelivered stop pre-fills the customer and document number fields automatically.

### My Routes

Accessed via the route icon (🔄) in the header after login. Drivers can:

- **Create a route** — give it an optional name and date, search for customers to add as stops, enter a document number per stop, and drag to reorder
- **Filter routes** by status — All / Drafts / Active / Completed (defaults to All)
- **Start a route** — changes status to Active and timestamps the start
- **Work through stops** — each delivered stop is ticked off automatically as deliveries are recorded
- **Finish a route** — enabled at any time; shows "Finish Early (X/Y)" in amber if stops remain, with a confirmation prompt before completing

**Deleting routes:** A red bin icon appears next to any route that is safe to delete — draft routes always, and active routes that have never been started. Routes in progress or completed cannot be deleted.

### My Deliveries (driver history)

Accessed via the clock icon (🕐) in the header after login — **no PIN required**. Shows only the logged-in driver's own deliveries. Supports date presets (Today, Yesterday, This Week, Last Week), a manual date range picker, and customer name search.

Tap any record to see the full detail view: photo (tap to expand fullscreen), customer, date, time, GPS address and coordinates, document number, notes, and filename.

If a single day is selected, a map icon appears that plots all drops in chronological order with numbered markers and a dashed route line.

### History (admin)

Accessed from the login screen or header via the clock icon — **requires admin PIN**. Shows all drivers' deliveries. Includes the same date filters as driver history plus driver name search and driver filter chips.

### Analytics (admin)

Accessed from the login screen or header — **requires admin PIN**. Shows:

- **Top Driver** — driver with the most drops in the period (tie-aware)
- **Top Customer** — customer code with the most drops (tie-aware)
- **Estimated Miles** — Haversine distance between consecutive GPS-tagged drops per driver, converted to miles
- **Deliveries by Driver** — doughnut chart with shades of blue, total in centre
- **Deliveries by Customer** — doughnut chart, top 10 shown, remainder noted as "+X more"
- **Deliveries by Hour** — bar chart, peak hour highlighted in dark blue

Date range presets: Today / Yesterday / This Week / Last Week / This Month / Last Month.

### Configuration (admin)

Accessed from the login screen — **requires admin PIN**. Shows the current hardcoded Supabase settings (read-only). The admin PIN field displays as `****`. To change any setting, edit `index.html` directly — see [Making Changes](#making-changes).

---

## Admin Access

All three admin screens (History, Analytics, Configuration) are protected by a 4-digit admin PIN. This is separate from driver PINs.

The admin PIN is stored in plain text inside `index.html` in the `config` block:

```javascript
pin: '1122'
```

To change it, edit this value and redeploy. If the PIN is ever forgotten, open `index.html` in any text editor and search for `config.pin`.

---

## Managing Drivers

All driver management is done directly in the Supabase dashboard → Table Editor → `drivers` table.

### Add a driver

```sql
insert into drivers (name, pin, active)
values ('Alice', '5678', true);
```

The name appears exactly as typed on the login grid. Keep it to a single word or short name so it fits the grid layout well.

### Change a driver's PIN

```sql
update drivers set pin = '9012' where name = 'Alice';
```

### Deactivate a driver (hides them from the login grid without deleting records)

```sql
update drivers set active = false where name = 'Alice';
```

### Remove a driver entirely

```sql
delete from drivers where name = 'Alice';
```

> Deleting a driver does not delete their delivery records. Historical records retain the driver name as a text field.

---

## Managing Customers

### Add a single customer

```sql
insert into customers (name, active)
values ('C099 - JOHN SMITH', true);
```

### Bulk import via CSV

In the Supabase dashboard go to **Table Editor → customers → Import data** and upload a CSV with columns `name` and `active`. Ensure the naming convention `CODE - FULL NAME` is followed.

### Deactivate a customer

```sql
update customers set active = false where name = 'C099 - JOHN SMITH';
```

Deactivated customers no longer appear in search results but their historical delivery records are unaffected.

---

## Routes

Routes are planned delivery runs. A route has:

| Field | Description |
|---|---|
| `route_name` | Optional label, e.g. "Morning Run" |
| `route_date` | The date the route is planned for |
| `stops` | Ordered array of stops, each with a customer name and optional document number |
| `status` | `draft` → `active` → `completed` |
| `started_at` | Timestamp when Start Route was tapped |
| `completed_at` | Timestamp when Finish Route was tapped |

Drivers build routes from the My Routes screen, including a document number (invoice, order, or pick note) per stop. When a route is active, tapping a stop on the delivery form pre-fills the customer and document number automatically.

---

## Offline Mode

If a driver submits a delivery without an internet connection:

1. The photo is converted to base64 and the full record is saved to the browser's IndexedDB store
2. An amber sync bar appears showing the number of queued deliveries
3. When the connection returns, the queue syncs automatically — photos upload first, then records are inserted into Supabase
4. The sync bar turns green briefly on completion

The offline queue survives page refreshes. Drivers can record multiple deliveries while offline and they will all sync when signal returns.

---

## Deployment

The app is a single file deployed via GitHub Pages.

### Initial setup

1. Create a GitHub repository (public or private — Pages works with both on paid plans)
2. Add `index.html` to the root of the repository
3. Go to **Settings → Pages** and set the source to the `main` branch, root folder
4. GitHub will provide a URL in the format `https://your-org.github.io/your-repo/`

### Updating the app

1. Edit `index.html` locally
2. Commit and push to the `main` branch
3. GitHub Pages redeploys automatically within a minute or two

Drivers may need to hard-refresh their browser (or clear the cache) after an update to load the new version. On mobile, closing and reopening the browser tab is usually sufficient.

### Custom domain (optional)

In **Settings → Pages → Custom domain**, enter your domain. Add a `CNAME` file to the repository root containing the domain, and configure your DNS provider to point to GitHub Pages.

---

## Making Changes

The entire application lives in `index.html`. There are no build steps, dependencies, or package managers involved.

### Changing the admin PIN

Find the `config` block near the top of the `<script>` section and update the `pin` value:

```javascript
const config = {
  // ...
  pin: '9999'   // ← change this
};
```

### Changing Supabase credentials

Update the `url` and `key` values in the same `config` block.

### Changing the app's colour scheme

CSS custom properties are defined in the `:root` block near the top of the `<style>` section:

```css
:root {
  --brand:      #004b8e;   /* dark blue — primary colour */
  --accent:     #0099ff;   /* bright blue — highlights */
  --off-white:  #f4f7fb;   /* page background */
  --border:     #dce8f5;   /* card borders */
  --success:    #00b86b;   /* green */
  --error:      #e03c3c;   /* red */
}
```

### Adding a new screen or feature

All JavaScript is in a single `<script>` block at the bottom of the file. Views are `<div>` elements in `<main>` toggled with `.show` classes. Follow the existing pattern of `showX()` / hide all others.

---

## Design System

| Token | Value | Usage |
|---|---|---|
| `--brand` | `#004b8e` | Headers, buttons, labels, links |
| `--accent` | `#0099ff` | Highlights, active states |
| `--off-white` | `#f4f7fb` | Page background, input backgrounds |
| `--border` | `#dce8f5` | Card and input borders |
| `--success` | `#00b86b` | Success states, ticks, GPS confirmed |
| `--error` | `#e03c3c` | Errors, delete actions |
| `--text` | `#0d1b2a` | Primary text |
| `--text-muted` | `#5a7a9a` | Secondary text, labels |

**Fonts:** Barlow Condensed (headings, labels, numbers) and Barlow (body text) — loaded from Google Fonts.

**Border radius:** 16px on cards, 10px on inputs and smaller elements, 20px on pill-shaped buttons.

**Header pills** (route, history, logout): 36×36px, `rgba(255,255,255,0.18)` background, 10px border radius.

---

## Architecture Notes

### Why a single file?

The single-file approach means the app can be deployed to GitHub Pages with no build pipeline. Any developer with a text editor can read, understand, and modify the entire application. Drivers access it via a URL — no app store, no install, no updates to push.

### Why no Supabase SDK?

The Supabase JavaScript SDK adds ~200KB to the bundle. Since the app uses only a handful of REST endpoints, all API calls are made with the native `fetch()` function directly against the PostgREST API. This keeps the file lean and the logic easy to read.

### Why is RLS disabled?

Row Level Security is disabled on all tables. The app is an internal tool used only by FMF drivers and admins on a known URL. Access is controlled at the application level (driver PINs, admin PIN) rather than at the database level. The anon key only allows the operations explicitly permitted by the anon policies (`insert` and `select` on deliveries, `select` on drivers and customers).

### Photo storage

Photos are uploaded to the `delivery-photos` Supabase Storage bucket. The bucket is public, meaning photo URLs are direct links accessible without authentication. Filenames include the date, time, and customer name: `YYYYMMDD_HHMMSS_CustomerName.jpg`.

### Driver session

Driver login state is stored in `localStorage` under the key `fmf_driver`. This means the driver stays logged in when the browser is closed and reopened. Tapping the logout button clears this key and returns to the login screen.

### z-index stacking

| Element | z-index |
|---|---|
| PIN modal | 700 |
| Config panel | 600 |
| Login screen | 500 |
| Lightbox / map overlay | 400 |
| Route editor overlay | 350 |
| Customer dropdown | 300 |

---

## Troubleshooting

### The driver grid doesn't appear on the login screen

1. Hard refresh the browser (`Ctrl+Shift+R` on desktop, or clear cache on mobile)
2. Open browser DevTools → Console and check for errors
3. Verify the `drivers` table exists in Supabase and has at least one row with `active = true`
4. Check the `url` and `key` in the `config` block are correct

### Deliveries are saving but photos aren't appearing

1. Check the `bucket` value in `config` matches the exact name of your Supabase Storage bucket
2. Ensure the bucket is set to **Public** in the Supabase dashboard
3. Check the browser console for upload errors

### GPS location always shows "Approximate"

The browser requests location permission when a delivery is submitted. If the driver has denied location access for the site, GPS will fall back to an approximate position or no coordinates at all. On iOS, go to **Settings → Safari → Location** and allow. On Android, check site permissions in Chrome settings.

### The admin PIN was forgotten

Open `index.html` in any text editor and search for `config.pin`. The PIN is stored in plain text there.

### Customers aren't showing in search

1. Check the `customers` table has rows with `active = true`
2. Confirm the anon select policy is in place on the `customers` table
3. Verify there are no network errors in the browser console when the form loads

### An offline delivery didn't sync after reconnecting

The sync bar should appear automatically when the connection returns. If it doesn't:
1. Refresh the page — the queue check runs on load
2. Open DevTools → Application → IndexedDB → `fmf_pod_offline` to inspect queued records
3. If records are present but not syncing, check the browser console for errors during the upload attempt

---

## Files in This Repository

```
├── index.html    ← The entire application
└── README.md     ← This file
```

That's it. There are no dependencies, no `node_modules`, no `package.json`, no build output folders.
