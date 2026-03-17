# FMF POD — Proof of Delivery

A mobile-friendly web application for recording and managing delivery confirmations. Built as a single HTML file, hosted on GitHub Pages, with data stored in Supabase.

---

## Features

- **Delivery recording** — capture driver name, customer, photo, GPS location, timestamp and notes in one simple form
- **Photo upload** — photos saved to Supabase Storage, named automatically as `YYYYMMDD_HHMMSS_CustomerName.jpg`
- **GPS location** — automatically captures coordinates and reverse-geocodes to a readable address at the point of submission
- **Customer search** — searchable dropdown populated from a Supabase `customers` table, ensuring consistent naming across all records
- **Offline mode** — deliveries submitted without a connection are queued locally on the device and automatically synced to Supabase when connectivity returns
- **Delivery history** — PIN-protected history view with search, date range and driver filter, grouped by driver in ascending time order
- **Analytics** — PIN-protected analytics page with stat cards, a doughnut chart of deliveries by driver, and an hourly delivery bar chart
- **No login required** — drivers access via a direct URL in any mobile browser, no app install or account needed

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Single HTML file (HTML, CSS, vanilla JS) |
| Hosting | GitHub Pages |
| Database | Supabase (PostgreSQL) |
| File Storage | Supabase Storage |
| Offline Storage | Browser IndexedDB |
| Charts | Chart.js |
| Geocoding | OpenStreetMap Nominatim (free, no API key) |

---

## Project Structure

```
/
├── index.html        # The entire application
└── README.md         # This file
```

---

## Supabase Setup

### 1. Create the `deliveries` table

```sql
create table deliveries (
  id                uuid default gen_random_uuid() primary key,
  customer_name     text not null,
  driver_name       text not null,
  delivery_datetime timestamptz not null,
  photo_url         text,
  photo_filename    text,
  notes             text,
  latitude          double precision,
  longitude         double precision,
  address           text,
  created_at        timestamptz default now()
);

alter table deliveries disable row level security;

create policy "Allow public inserts"
on deliveries as permissive for insert to anon with check (true);

create policy "Allow public reads"
on deliveries for select to anon using (true);
```

### 2. Create the `customers` table

```sql
create table customers (
  id         uuid default gen_random_uuid() primary key,
  name       text not null unique,
  active     boolean default true,
  created_at timestamptz default now()
);

alter table customers disable row level security;
```

### 3. Create the Storage bucket

- Go to **Storage → New bucket**
- Name it `delivery-photos`
- Set it to **Public**
- Run the following in SQL Editor:

```sql
create policy "Allow public uploads"
on storage.objects as permissive for insert to anon
with check (bucket_id = 'delivery-photos');

create policy "Public bucket access"
on storage.objects for all to anon
using (bucket_id = 'delivery-photos')
with check (bucket_id = 'delivery-photos');
```

---

## GitHub Pages Deployment

1. Create a new GitHub repository (e.g. `fmf-pod`)
2. Upload `index.html` (rename from `proof-of-delivery.html` if needed)
3. Upload `README.md`
4. Go to **Settings → Pages → Source → Deploy from branch → main**
5. Your app will be live at `https://yourusername.github.io/fmf-pod`

Share the URL with drivers — they can bookmark it on their phone's home screen for quick access.

---

## Configuration

The app configuration is hardcoded directly in `index.html`. To change any setting, open the file and locate the `config` block near the top of the `<script>` section:

```javascript
const config = {
  url:    'https://your-project.supabase.co',
  key:    'your-anon-public-key',
  bucket: 'delivery-photos',
  table:  'deliveries',
  pin:    '1234'
};
```

| Setting | Description |
|---|---|
| `url` | Your Supabase project URL (Settings → API) |
| `key` | Your Supabase anon/public key (Settings → API) |
| `bucket` | Supabase Storage bucket name for photos |
| `table` | Supabase table name for delivery records |
| `pin` | 4-digit PIN to access History and Analytics |

> The anon/public key is safe to include in client-side code — it is designed for browser use and access is controlled by Supabase Row Level Security policies.

---

## CORS Configuration

Because the app is hosted on GitHub Pages and makes API calls to Supabase, your GitHub Pages domain must be whitelisted.

Go to: **Supabase → Project Settings → API → CORS** and add:

```
https://yourusername.github.io
```

---

## Offline Mode

The app supports fully offline delivery recording. When a driver has no internet connection:

1. A yellow notice appears on the form: *"No connection — delivery will be saved and uploaded when you're back online"*
2. The driver fills in and submits the form as normal
3. The photo and all delivery data are saved locally on the device using **IndexedDB** (the browser's built-in local database)
4. The success screen confirms the delivery was saved offline
5. An amber sync bar appears in the app showing how many deliveries are queued

When the connection returns, the app automatically detects this and syncs all queued deliveries to Supabase in the background — no action required from the driver. The sync bar turns green on completion and then disappears.

**Important notes for drivers:**
- Queued deliveries survive closing and reopening the browser — they are stored on the device until synced
- Do not clear browser site data while deliveries are queued offline — this will permanently delete unsynced records
- History and Analytics still require an active internet connection as they read from Supabase

---

## Managing Customers

Customers are managed directly in Supabase — no code changes required.

**Add a single customer:**
Table Editor → customers → Insert row → fill in `name` → Save

**Bulk import via CSV:**
1. Create a `.csv` file with a single column headed `name`
2. One customer name per row
3. Table Editor → customers → Import data → select your file → Import

**Hide a customer without deleting:**
Find the row → set `active` to `false` → Save

**Customer naming convention:**
The analytics Top Customer stat uses the first segment of the customer name before ` - ` as a short code. For example `A137 - MICHAEL GOMEZ` displays as `A137`. It is recommended to follow this `CODE - FULL NAME` format for all customers to keep analytics readable.

---

## Managing Drivers

The driver list is hardcoded in `index.html`. To add or remove drivers, locate the driver grid section and update the buttons:

```html
<button class="driver-btn" onclick="selectDriver(this,'DriverName')">DriverName</button>
```

Current drivers: Paddy, Becky, Ben, Ian, Ken, Nick, Sam, James.

An **Other / Not listed** option is always available for drivers not in the preset list, allowing a name to be typed manually.

---

## History

The History screen is PIN-protected (same PIN as Analytics). It provides:

- **Search** — filter by customer name or driver name
- **Date range** — defaults to today, adjustable via From/To date pickers
- **Driver filter chips** — dynamically generated from records in the database, including any manually entered names
- **Grouped view** — records grouped by driver, sorted ascending by time within each group
- **Detail view** — tap any record to see the full delivery detail including photo (tap photo to fullscreen), address, coordinates, driver, customer, date, time and notes

---

## Analytics

The Analytics screen is PIN-protected (same PIN as History). It provides:

### Date range filter
Defaults to today. Adjustable via From/To date pickers — all charts and stat cards update automatically when changed.

### Stat cards
Two cards displayed side by side:

| Card | Shows |
|---|---|
| **Top Driver** | Name of the driver with the most deliveries, plus their drop count (e.g. "14 drops") |
| **Top Customer** | Short code of the most-delivered-to customer (first part before ` - `), plus their drop count |

### Deliveries by Driver — Doughnut chart
A doughnut chart in shades of blue showing the split of deliveries across drivers for the selected date range. The total delivery count is displayed in the centre of the chart. A custom legend below shows each driver's name, count and percentage.

### Deliveries by Hour of Day — Bar chart
A bar chart showing how many deliveries were completed in each hour of the working day. The peak hour is highlighted in full dark blue (`#004b8e`) while all other hours appear in a lighter blue, making the busiest time of day immediately visible. Tooltips show the exact hour range and delivery count when tapped. The chart automatically scales to only show relevant working hours based on the data.

---

## PIN Protection

Both the History and Analytics screens require a 4-digit PIN. The PIN is set in the `config` block in `index.html`. The same PIN is used for both screens. The PIN is never displayed in the app — the Config panel shows `****` in its place.

---

## License

Internal use only — FMF.
