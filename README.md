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
- [Customer Addresses & Navigation](#customer-addresses--navigation)
- [Offline Mode](#offline-mode)
- [Diagnostic Log](#diagnostic-log)
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
- The active route stop the delivery belongs to, if any

Admins can review history, view delivery maps, plan and optimise routes, manage customer delivery addresses, monitor drivers live via the Overview wallboard, and inspect a diagnostic log of app errors — all through PIN-protected screens. Everything runs from a single `index.html` file with no build tools, no frameworks, and no app store.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Single `index.html` — HTML, CSS, vanilla JavaScript |
| Hosting | GitHub Pages |
| Database | Supabase (PostgreSQL, accessed via REST API — no SDK) |
| File Storage | Supabase Storage |
| Offline Queue | Browser IndexedDB (`fmf_pod_offline`), auto-syncs on reconnect |
| Charts | Chart.js (loaded from CDN) |
| Maps | Leaflet.js + OpenStreetMap (loaded from CDN, no API key) |
| Geocoding | OpenStreetMap Nominatim (free, no API key) |
| PDF | jsPDF (loaded from CDN) — POD PDF share/download |
| Navigation | Device deep-links — Google Maps, Apple Maps, Waze (no API key) |

---

## Getting Started

The app is live at your GitHub Pages URL. Drivers navigate to that URL on their phone and log in. No installation needed.

To access the app as a driver:
1. Open the URL in any mobile browser (Safari on iOS, Chrome on Android)
2. Tap your name on the login screen
3. Enter your personal 4-digit PIN
4. The delivery form loads — you're ready to record drops

To access admin features (History, Analytics, Address Manager, Configuration, Overview):
1. From the login screen, tap the relevant icon in the top-right corner
2. Enter the admin PIN when prompted

Admin screens are also reachable via URL hash deep links (`#history`, `#analytics`, `#addresses`, `#overview`) — these still require the admin PIN; there is no bypass.

---

## Supabase Setup

The app connects to a Supabase project. The connection details are hardcoded in the `config` block near the top of the `<script>` section in `index.html`:

```javascript
const config = {
  url:      'https://your-project.supabase.co',
  key:      'your-anon-key',
  bucket:   'delivery-photos',
  table:    'deliveries',
  pin:      '1122',           // Admin PIN — change this to whatever you like
  depotLat: 53.202728542529755, // Used as the route start/distance-reference point
  depotLng: -0.614144219365714  // on the Overview wallboard and route map preview
};
```

| Setting | Where to find it |
|---|---|
| `url` | Supabase dashboard → Project Settings → API → Project URL |
| `key` | Supabase dashboard → Project Settings → API → Project API Keys → `anon` / `public` |
| `bucket` | The name of your Supabase Storage bucket |
| `table` | The name of your deliveries table (default: `deliveries`) |
| `pin` | Your chosen 4-digit admin PIN — stored only in this file |
| `depotLat` / `depotLng` | Coordinates of the depot/start point used for route distance and the map's depot marker |

> **Security note:** The `anon` key is safe to hardcode. It is public-facing by design. Never hardcode your `service_role` key. Note that Row Level Security is currently **disabled** on all tables (see [Architecture Notes](#architecture-notes)), so the anon key effectively has full read/write access — treat the URL as something only trusted users should have, not just the key.

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
  route_id          uuid,
  created_at        timestamptz default now()
);

-- Allow anonymous inserts and reads (internal tool — no user auth)
create policy "anon_insert" on deliveries for insert using (true) with check (true);
create policy "anon_select" on deliveries for select using (true);
```

`doc_number` and `notes` are separate fields — `doc_number` is the structured invoice/order/pick-note reference shown prominently on history and route cards; `notes` is free text. `route_id` links a delivery back to the active route it was recorded against, if any.

> **If you already have a `deliveries` table** without these columns, add them with:
> ```sql
> alter table deliveries add column if not exists doc_number text;
> alter table deliveries add column if not exists route_id uuid;
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

Customer names follow the convention `CODE - FULL NAME`, e.g. `A137 - MICHAEL GOMEZ`. The code portion (before the ` - `) is used in analytics and to link `customer_addresses` records.

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
  route_name   text,
  route_date   date not null,
  stops        jsonb not null default '[]',
  status       text not null default 'draft',
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz default now()
);

create policy "anon_all" on routes for all using (true) with check (true);
```

`status` moves through `draft` → `active` → `completed`. `completed_at` also drives the 30-minute grace window on the Overview wallboard (a driver who just finished stays visible for 30 minutes).

The `stops` column is a JSONB array. Each stop carries a customer name, optional document number, and — once addressed — geocoded location data:

```json
[
  { "customer": "A137 - MICHAEL GOMEZ", "doc_number": "INV-4521", "lat": 53.21, "lng": -0.60, "address_line": "1 High Street", "postcode": "LN1 1AA", "address_id": "...", "address_label": "Main Site" },
  { "customer": "B204 - SARAH JONES",   "doc_number": null }
]
```

The array also contains one sentinel entry marking the route's final destination, used for the map preview and distance calculation — it carries `"__final_dest": true` instead of a `customer` field, so any code reading `stops` should filter it out before treating entries as delivery stops.

### `customer_addresses`

```sql
create table customer_addresses (
  id             uuid primary key default gen_random_uuid(),
  customer_code  text not null,
  label          text,
  address_line   text,
  postcode       text,
  lat            double precision,
  lng            double precision,
  created_at     timestamptz default now()
);

create policy "anon_all" on customer_addresses for all using (true) with check (true);
```

Added in Session 5 to support Smart Routes. `customer_code` is the code portion of a `customers.name` value (the part before ` - `), allowing a customer to have multiple delivery addresses under one code. Used by the Address Manager (search/add/edit/delete), the route editor's address picker, Quick-Add Address, and route auto-optimisation. A customer can appear more than once on a route if they have multiple addresses.

### `app_logs`

```sql
create table app_logs (
  id          uuid primary key default gen_random_uuid(),
  ts          timestamptz not null default now(),
  driver_name text,
  type        text,
  severity    text,
  screen      text,
  online      boolean,
  session_id  text,
  detail      text,
  user_agent  text
);

create policy "anon_insert" on app_logs for insert using (true) with check (true);
create policy "anon_select" on app_logs for select using (true);
```

Powers the in-app [Diagnostic Log](#diagnostic-log). `severity` is one of `info` / `warn` / `error`. `session_id` is a random ID generated fresh per page load, letting admins tell apart a single continuous session from a silent page reload. `screen` records which view the event happened on. This table did not exist before this session's work — if you're updating an existing deployment, run the `CREATE TABLE` above, or if it already partially exists, add the missing columns:

```sql
alter table app_logs add column if not exists severity text;
alter table app_logs add column if not exists screen text;
alter table app_logs add column if not exists online boolean;
alter table app_logs add column if not exists session_id text;
```

### Storage bucket

In the Supabase dashboard, go to **Storage** and create a bucket named `delivery-photos`. Set it to **Public** so photo URLs are directly accessible without authentication.

---

## App Screens

### Login

The full-screen login overlay is the first thing all users see. Drivers select their name from a grid and enter their personal 4-digit PIN. On success, the session is saved to `localStorage` (key `fmf_driver`) so the driver stays logged in across page refreshes. The logout button (→ icon in the header) clears the session.

Five admin icon buttons are visible in the top-right corner of the login screen — History, Analytics, Address Manager, Config, and Overview. Each requires the admin PIN before opening.

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

When an active route is assigned for today, a route card appears above the welcome strip showing the stop list. Tapping an undelivered stop pre-fills the customer and document number fields automatically, and a Nav button opens the stop's address in the driver's preferred maps app (Google Maps, Apple Maps on iOS, or Waze) via a device deep-link — no API key required.

### My Routes

Accessed via the route icon (🔄) in the header after login. Drivers and admins can:

- **Create a route** — give it an optional name and date, search for customers to add as stops (with an address picker drawing from `customer_addresses`), enter a document number per stop, and drag to reorder
- **Auto-optimise** a route's stop order using a nearest-neighbour pass followed by 2-opt refinement (not guaranteed optimal, but substantially better than nearest-neighbour alone)
- **Filter routes** by status — All / Drafts / Active / Completed (defaults to All)
- **Start a route** — changes status to Active and timestamps the start
- **Work through stops** — each delivered stop is ticked off automatically as deliveries are recorded
- **Finish a route** — enabled at any time; shows "Finish Early (X/Y)" in amber if stops remain, with a confirmation prompt before completing
- **Quick-Add an address** for a stop missing one, without leaving the route editor — a bottom-sheet overlay saves directly to `customer_addresses` (this save is permanent; there's no draft/discard, so typos need correcting afterward in the Address Manager)

A banner above the stop list counts any stops missing an address and links to Quick-Add per stop.

**Deleting routes:** A red bin icon appears next to any route that is safe to delete — draft routes always, and active routes that have never been started. Routes in progress or completed cannot be deleted.

### My Deliveries (driver history)

Accessed via the clock icon (🕐) in the header after login — **no PIN required**. Shows only the logged-in driver's own deliveries. Supports date presets (Today, Yesterday, This Week, Last Week), a manual date range picker, and customer name search. Date filtering is done server-side against Supabase (not client-side slicing), so it's correct across BST/GMT and not limited by any record cap.

Tap any record to see the full detail view: photo (tap to expand fullscreen), customer, date, time, GPS address and coordinates, document number, notes, and filename. Admins additionally see a Re-geocode button to re-resolve the address from stored coordinates, and a Share/Download POD PDF button (generated via jsPDF).

If a single day is selected, a map icon appears that plots all drops in chronological order with numbered markers and a dashed route line.

### History (admin)

Accessed from the login screen or header via the clock icon, or URL hash `#history` — **requires admin PIN**. Shows all drivers' deliveries. Includes the same date filters as driver history plus driver name search and driver filter chips.

### Analytics (admin)

Accessed from the login screen or header, or URL hash `#analytics` — **requires admin PIN**. Shows:

- **Top Driver** — driver with the most drops in the period (tie-aware)
- **Top Customer** — customer code with the most drops (tie-aware)
- **Estimated Miles** — Haversine distance between consecutive GPS-tagged drops per driver, converted to miles
- **Deliveries by Driver** — doughnut chart with shades of blue, total in centre
- **Deliveries by Customer** — doughnut chart, top 10 shown, remainder noted as "+X more"
- **Deliveries by Hour** — bar chart, peak hour highlighted in dark blue

Date range presets: Today / Yesterday / This Week / Last Week / This Month / Last Month.

### Address Manager (admin)

Accessed from the login screen or URL hash `#addresses` — **requires admin PIN**. Search, add, edit, geocode, and delete customer delivery addresses (`customer_addresses` table). A customer can have multiple labelled addresses (e.g. "Main Site", "Warehouse"). A Re-geocode button resolves lat/lng from the address line and postcode via Nominatim. Geocoding quality depends on Nominatim's match confidence; the standalone `regeocode.html` tool can be run separately to bulk re-geocode all records.

### Overview Wallboard (admin)

Accessed from the login screen or URL hash `#overview` — **requires admin PIN**. A full-screen, dark-themed dashboard intended for an office display: a live grid of every driver's current route status, a live clock, and auto-refresh every 60 seconds. A driver who has just completed their route remains visible for a 30-minute grace period (hardcoded in `ovShouldShowDriver()`) before dropping off the board. The app header is hidden while the wallboard is open and restored on exit.

### Configuration (admin)

Accessed from the login screen — **requires admin PIN**. Shows the current hardcoded Supabase settings (read-only). The admin PIN field displays as `****`. To change any setting, edit `index.html` directly — see [Making Changes](#making-changes). This screen also hosts the [Diagnostic Log](#diagnostic-log).

---

## Admin Access

All five admin screens (History, Analytics, Address Manager, Configuration, Overview) are protected by a single 4-digit admin PIN. This is separate from driver PINs.

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

In the Supabase dashboard go to **Table Editor → customers → Import data** and upload a CSV with columns `name` and `active`. Ensure the naming convention `CODE - FULL NAME` is followed. The repository's `import_customer_addresses.py` script was used for the original one-time bulk import of addresses from Excel and is retained for reference.

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
| `stops` | Ordered array of stops, each with a customer name, optional document number, and optional geocoded address |
| `status` | `draft` → `active` → `completed` |
| `started_at` | Timestamp when Start Route was tapped |
| `completed_at` | Timestamp when Finish Route was tapped — also drives the Overview wallboard's 30-minute grace period |

Drivers build routes from the My Routes screen, including a document number per stop and, where available, a specific delivery address pulled from `customer_addresses`. When a route is active, tapping a stop on the delivery form pre-fills the customer and document number automatically, and a Nav button launches turn-by-turn directions in the driver's maps app of choice.

---

## Customer Addresses & Navigation

Introduced across Sessions 5–8 (Smart Routes and In-App Navigation), this layer sits between the customer list and the route editor:

- The **Address Manager** (admin) is the source of truth for `customer_addresses` — search, add, edit, geocode, and delete.
- The **route editor's address picker** lets a driver/admin attach a specific address to a stop when a customer has more than one.
- **Quick-Add Address** lets a driver add a missing address inline from the route editor without navigating away — it saves immediately and permanently, so double-check entries before saving.
- **Route auto-optimisation** (nearest-neighbour + 2-opt) uses each stop's `lat`/`lng` to reorder stops for a shorter route; stops without a geocoded address can't be optimised and are flagged via the missing-address banner.
- **In-app navigation** opens a stop's address as a device deep-link to Google Maps, Apple Maps (iOS only, detected via user agent), or Waze — no API key needed, and it opens the driver's actual installed app.

---

## Offline Mode

If a driver submits a delivery without an internet connection, or loses connection partway through submitting:

1. The photo is converted to base64 and the full record is saved to the browser's IndexedDB store (`fmf_pod_offline`)
2. An amber sync bar appears showing the number of queued deliveries
3. When the connection returns, the queue syncs automatically — photos upload first, then records are inserted into Supabase

**Mid-submission failure handling:** if the photo uploads successfully but the database insert then fails (a connection drop between the two network calls — common in patchy signal), the app does **not** re-upload the photo or lose the record. It queues a database-only record referencing the already-uploaded photo, and shows the driver "📶 Poor signal — record saved locally, will sync automatically" instead of an error. This keeps a single delivery from ever producing a duplicate photo upload or an orphaned file with no matching record.

The offline queue survives page refreshes. Drivers can record multiple deliveries while offline and they will all sync when signal returns. The sync bar turns green briefly on completion.

`loadActiveRoute()` and `initCustomers()` both have an in-flight guard, so if the device comes back online and the tab becomes visible again at roughly the same moment (e.g. waking from being locked), only one network request fires instead of two competing ones — this matters specifically in poor-signal conditions where doubling requests doubles the chance of failure.

---

## Diagnostic Log

A live admin-facing log, found in the Config panel, backed by the `app_logs` table. It records:

- Uncaught JS errors and unhandled promise rejections, anywhere in the app
- Every network failure across submit, route save/start/finish/delete, address save/delete, Quick-Add, POD generation, history/analytics/overview load, and re-geocode — each tagged with which screen it happened on and whether the device was online at the time
- Successful submits and syncs, customer/driver list loads, and offline-queue activity

Each entry carries a **severity** (`info` / `warn` / `error`) and a **session_id** — entries sharing a session ID came from the same continuous page load; a change in session ID for the same driver within a short window means the page silently reloaded (commonly Android reclaiming memory from a backgrounded tab, not an app bug).

Network error messages are classified rather than passed through raw — instead of the unhelpful browser default "Failed to fetch", entries distinguish a request timeout, the device being offline, and a connection dropping mid-request with signal present. Use the severity filter (set to "Errors only") to cut through routine pre-login noise like `app_start` and `customers_fetch`, which fire before any driver is logged in and are expected, not faults.

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

### Changing the depot location

Update `depotLat` / `depotLng` in the `config` block — used for route distance and the map preview's depot marker.

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

All JavaScript is in a single `<script>` block at the bottom of the file. Views are `<div>` elements in `<main>` toggled with `.show` classes. Follow the existing pattern of `showX()` / hide all others, and set `window._currentScreen` in the show function so any errors on that screen are tagged correctly in the diagnostic log.

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

**Overview Wallboard** uses its own dark palette, separate from the rest of the app: background `#0f1923`, header bar `#111827`, driver cards `#1a2535`.

---

## Architecture Notes

### Why a single file?

The single-file approach means the app can be deployed to GitHub Pages with no build pipeline. Any developer with a text editor can read, understand, and modify the entire application. Drivers access it via a URL — no app store, no install, no updates to push.

### Why no Supabase SDK?

The Supabase JavaScript SDK adds ~200KB to the bundle. Since the app uses only a handful of REST endpoints, all API calls are made with the native `fetch()` function directly against the PostgREST API via a shared `sbRequest()` helper. This keeps the file lean and the logic easy to read.

### Why is RLS disabled?

Row Level Security is disabled on all tables. The app is an internal tool used only by FMF drivers and admins on a known URL. Access is controlled at the application level (driver PINs, admin PIN) rather than at the database level. The anon key allows the operations explicitly permitted by the anon policies on each table.

### Photo storage

Photos are uploaded to the `delivery-photos` Supabase Storage bucket. The bucket is public, meaning photo URLs are direct links accessible without authentication. Filenames include the date, time, and customer name: `YYYYMMDD_HHMMSS_CustomerName.jpg`.

### Driver session

Driver login state is stored in `localStorage` under the key `fmf_driver`. This means the driver stays logged in when the browser is closed and reopened, unless the browser/OS clears site storage (uncommon, but possible under memory pressure on some Android devices). Tapping the logout button clears this key and returns to the login screen.

### Concurrency guards

`loadActiveRoute()` and `initCustomers()` are each triggered from multiple independent events (login, the `online` event, `visibilitychange`, and after every submit). Both have an in-flight lock (`_loadingRoute`, `_loadingCustomers`) so overlapping triggers collapse into a single request instead of firing duplicate parallel ones — important on poor signal, where doubling outstanding requests doubles the chance any one of them fails.

### z-index stacking

| Element | z-index |
|---|---|
| PIN modal | 700 |
| Doc Number Modal | 630 |
| Quick-Add Address sheet | 620 |
| Address Manager form | 610 |
| Config panel | 600 |
| Overview Wallboard | 510 |
| Login screen | 500 |
| Nav sheet | 450 |
| Overview overlay | 410 |
| Lightbox / map overlay | 400 |
| Route map preview | 380 |
| Route editor overlay | 350 |
| Customer dropdown | 300 |

---

## Troubleshooting

### The driver grid doesn't appear on the login screen

1. Hard refresh the browser (`Ctrl+Shift+R` on desktop, or clear cache on mobile)
2. Check the Diagnostic Log (Config panel) for `drivers_error` entries
3. Verify the `drivers` table exists in Supabase and has at least one row with `active = true`
4. Check the `url` and `key` in the `config` block are correct

### Deliveries are saving but photos aren't appearing

1. Check the `bucket` value in `config` matches the exact name of your Supabase Storage bucket
2. Ensure the bucket is set to **Public** in the Supabase dashboard
3. Check the Diagnostic Log for `photo_error` or `submit_db_insert_failed_after_upload` entries

### GPS location always shows "Approximate"

The browser requests location permission when a delivery is submitted. If the driver has denied location access for the site, GPS will fall back to an approximate position or no coordinates at all. On iOS, go to **Settings → Safari → Location** and allow. On Android, check site permissions in Chrome settings.

### The admin PIN was forgotten

Open `index.html` in any text editor and search for `config.pin`. The PIN is stored in plain text there.

### Customers aren't showing in search

1. Check the `customers` table has rows with `active = true`
2. Confirm the anon select policy is in place on the `customers` table
3. Check the Diagnostic Log for `customers_error` entries

### An offline delivery didn't sync after reconnecting

1. The sync bar should appear automatically when the connection returns; if not, refresh the page — the queue check runs on load
2. Open DevTools → Application → IndexedDB → `fmf_pod_offline` to inspect queued records
3. Check the Diagnostic Log for `sync_item_error` or `sync_error` entries — the message will now say specifically whether it was a timeout, the device being offline, or a mid-request connection drop

### A driver reports the app "glitching" or routes not loading in poor signal

1. Open the Diagnostic Log, filter severity to "Errors only" plus "Warnings", and filter by the driver's name
2. Look for `route_load_error` or `customers_error` — both have an automatic offline fallback to the last cached data, so a single entry isn't necessarily a driver-facing failure; repeated entries in a short window are the signal worth investigating
3. Compare `session_id` values across entries close together in time — a change in session ID for the same driver indicates the page silently reloaded, not an app fault

### Routes table or deliveries table is missing a column the app expects

Check this README's [Database Schema](#database-schema) section against your actual Supabase tables — columns get added over the life of the project (most recently `route_id` on `deliveries` and the whole `app_logs` table). Each schema block above includes an `alter table ... add column if not exists` snippet for bringing an existing table up to date without dropping data.

---

## Files in This Repository

```
├── index.html                       ← The entire application
├── README.md                        ← This file
├── regeocode.html                   ← Standalone tool to bulk re-geocode customer_addresses via Nominatim
└── import_customer_addresses.py     ← One-time script used to import address data from Excel into Supabase
```

There are no dependencies, no `node_modules`, no `package.json`, no build output folders.
