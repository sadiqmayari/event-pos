# Event POS

A point-of-sale PWA for a 4-day sales event. React + Vite + TypeScript + Tailwind, with Supabase for the database, staff login and live stock. Hosted on GitHub Pages.

| Stage | Status |
|---|---|
| 1. Setup, auth, products & stock | ✅ done |
| 2. Sales screen | ✅ done |
| 3. Invoices & printing (Black Copper BC-86AC) | ✅ done |
| 4. History, voids, reports | ✅ done |
| 5. Offline queue + PWA | ✅ done |
| 6. GitHub Pages deployment | ✅ workflow ready |

---

## 1. Create the Supabase project

1. Create a free project at [supabase.com](https://supabase.com). Choose the region closest to the event (e.g. Mumbai / Singapore for Pakistan).
2. **Turn off public sign-ups:** open **Authentication → Sign In / Providers**, then switch **Allow new users to sign up** off. Staff accounts are created only by you.
3. **Run the SQL:** open **SQL Editor → New query**, then paste and run each file **in order**:
   1. `supabase/migrations/001_schema.sql`
   2. `supabase/migrations/002_rls.sql`
   3. `supabase/migrations/003_stock_functions.sql`
   4. `supabase/migrations/004_sales.sql`
   5. `supabase/migrations/005_receipt_settings.sql`
   6. `supabase/migrations/006_voids_reports.sql`
   7. `supabase/migrations/007_print_stations.sql`
   8. `supabase/migrations/008_cashier_cashup.sql`
   9. `supabase/migrations/009_cashier_privacy.sql`
   9. *(optional, sample data)* `supabase/seed.sql` adds 40 sample products.
   10. *(optional, after creating a staff user)* `supabase/fake_sales.sql` creates 50 fake sales over the last 4 days through the real sale logic. Run `supabase/reset_test_data.sql` **before the event** to delete all test sales, put the sold stock back, and restart invoice numbers at 1.
4. **Create staff users:** open **Authentication → Users → Add user → Create new user**, enter an email and password, and tick *Auto confirm user*. Each new user gets a `profiles` row automatically, with the role **cashier**.
5. **Make yourself admin** by running this once in the SQL Editor (use your email):
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
   After that, manage roles from the app's **Staff** page.

## 2. Configure environment variables

Find the values under **Project Settings → API** (or **Connect**) in Supabase.

```bash
cp .env.example .env.local
```

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key, or the newer "publishable" key>
```

- `.env.local` is git-ignored. **Never commit it.**
- The anon/publishable key is designed to be public. It's safe here because Row Level Security blocks everything for anyone who isn't a logged-in, active staff member.
- **Never** put the `service_role` / secret key in this app.

## 3. Run locally

Requires Node 20+.

```bash
npm install
npm run dev        # → http://localhost:5173/event-pos/
npm run build      # type-check + production build
npm run test:db    # database tests (in-memory Postgres; no Supabase needed)
```

## 4. Testing Stage 1

1. Log in as the admin user. You should land on **Sell** (a placeholder until Stage 2).
2. Open **Stock**. You should see the 40 seed products, with summary tiles for low stock and out of stock (Hoodie and Lip Balm are low; Kids Sandals is out).
3. **Add a product** with a starting stock of 10. Then open **Adjust stock** on it: the movement history shows "Initial stock +10".
4. **Adjust stock:** try *+ Add*, *− Remove* and *= Set count*. A reason is required. Removing more than you have is rejected.
5. **Live stock:** open the app in two browsers (or on a laptop and a tablet), adjust stock in one, and watch it update in the other within about a second.
6. **CSV import:** click *Download template*, edit the file, then import it. Rows with problems are highlighted, and nothing is imported until every row is valid. Choose whether the stock column *replaces* or *adds to* current stock.
7. **Export CSV:** downloads the current stock list.
8. **Roles:** create a second user (a cashier) and log in as them in a private window. The cashier sees Stock as read-only, with no Add, Import, Edit or Adjust buttons, and has no Reports or Staff tabs.
9. **Staff page:** change a name (it's printed on receipts), promote, or deactivate someone. A deactivated user is locked out at once. You can't demote the last admin.

## 5. Testing Stage 2: the sales screen

The **Sell** tab is the main screen. On a tablet in landscape and on a laptop, products are on the left and the cart is on the right. On narrow screens the cart opens from a bar at the bottom.

1. **Add items:** tap product tiles. A teal badge shows how many are in the cart. You can't add more than the stock on hand: the tile greys out when you reach it.
2. **Search and scan:** type in the search box, or scan a barcode or type a SKU (e.g. `APP-001`) and press **Enter**. The product is added and the box clears, ready for the next scan. The category chips filter the grid.
3. **Change quantity:** use − / + on a cart line. Tap the line's name to set the quantity, add a **line discount** (Rs or %), or remove the item.
4. **Bill discount:** use **+ Bill discount** under the cart. It's applied after line discounts.
5. **Charge:**
   - **Cash:** use the keypad or the quick buttons (Exact, Rs 3,000, Rs 5,000…). *Change to give* updates as you type.
   - **Card:** charge the amount on the bank's card machine first, then optionally type the last 4 digits or a reference.
   - **Cash + Card:** enter the card part. The cash part is calculated, and you enter the cash received.
6. **"Sale complete" appears only after the database confirms the sale.** It shows the invoice number and the change to give. Stock drops on every device straight away.
7. **Two tills, last item:** set a product's stock to 1, put it in the cart on two devices, and charge both. The first succeeds; the second shows *"only 0 left"* and offers **Fix cart to available stock**.
8. **Price changed mid-sale:** with an item in the cart on one device, change its price on the Stock page on another. The cart updates and shows a notice.
9. **Lost connection:** turn wifi off and press Complete sale. You'll see *"Sale NOT confirmed"* with **Try again**. Retrying reuses the same sale id, so a sale that did reach the server is never recorded twice. (Stage 5 adds a proper offline queue.)
10. **The cart survives a page reload,** so a refreshed tab doesn't lose a half-built sale.

Database tests: `npm run test:db` covers all of this, including 50 fake sales whose stock ledger is checked to match current stock exactly.

## 6. Receipts & printing (Stage 3)

Every sale has a sequential invoice number, date/time (in the device's timezone), cashier name, items, discounts, totals, payment details and change. Open **Settings** to set things up.

**Receipt design (admin, shared by all devices):** set the event name, header lines (address, phone), footer lines (thank-you note, exchange policy), an optional logo, and the opening cash in the drawer. A live preview shows exactly what will print.

**Printer (per device):** each till chooses its own:

| Setting | Notes |
|---|---|
| Paper width | **80 mm** (a roll about 8 cm wide) or **58 mm** (about 5.8 cm). |
| Print automatically | On by default: a receipt prints as soon as a sale is saved. |
| Browser printing | Works on every device. The receipt is laid out for thermal paper; choose the printer in the print dialog. |
| USB (direct) | ESC/POS sent straight to the printer through WebUSB, in Chrome. **Best on Android tablets** with a USB-OTG cable. |
| Bluetooth (direct) | For BLE thermal printers (Chrome on Android/ChromeOS). Reconnect after reloading the page. |
| Serial / COM (direct) | For a printer that shows up as a COM port, e.g. a paired Bluetooth printer on Windows. |

If direct printing fails for any reason (unplugged, out of range, permission), the app **falls back to browser printing automatically** and shows why.

**Reprinting:** after a sale, the "Sale complete" screen has **Print receipt** / **Reprint**. The Sell screen has **Reprint last** for the last receipt from this device. Reprints are marked "REPRINT". Stage 4 adds reprinting any receipt from Sales history.

### Print station: phones print on the laptop's printer

Step-by-step setup guide for whoever runs the printer laptop: [docs/Print-Station-Setup.docx](docs/Print-Station-Setup.docx).
Phones and tablets without a printer can send their receipts to a laptop that has one.
1. **On the laptop with the printer:** go to Settings, set up its printer (ideally **USB (direct)**, so there's no print dialog), then under **Print station** enter a name (e.g. "Counter printer") and press **Use this device as a print station**. A 🖨 badge appears in the header. Keep the app open (any page) and stop the laptop sleeping.
2. **On each phone:** go to Settings → How to print → **Print station**, then choose the station.
3. Receipts from the phone (auto-print after a sale, **Reprint last**, reprints from History) print at the laptop within a few seconds. The phone shows "Printed at Counter printer". If the laptop is off, jobs wait and print when it comes back. Offline sales print once they sync.
4. The station's Settings page lists recent jobs. Failed ones can be retried there.

### Black Copper BC-86AC: recommended setup
- **Android tablet (Chrome):** connect the printer with a USB-OTG cable. Choose **Settings → USB (direct)**, pick the printer, then **Print test receipt**. This is the fastest option, with no print dialog.
- **Windows laptop:** install Black Copper's Windows driver, then in Windows *Printers → BC-86AC → Printing preferences* set paper to 80 mm (or 72 mm printable) with no margins. Use **Browser printing**. In Chrome's print dialog choose the BC-86AC, set Margins to *None* and turn off *Headers and footers* (Chrome remembers this). Tip: start Chrome with `--kiosk-printing` to print without the dialog.
  - *Advanced:* direct USB on Windows only works if you replace the driver with WinUSB (e.g. using Zadig). The printer then stops working for other Windows apps, so browser printing is usually better.
- **Printer test:** **Settings → Print test receipt** prints a receipt marked TEST PRINT.

## 7. History, voids & reports (Stage 4)

**Sales history (all staff):** filter by day (event days are listed, or pick any date), invoice number, cashier, payment method, or completed/voided. The list updates live as other tills sell. Tap a sale to see its receipt and **Reprint** it.

**Void / refund (admin):** in a sale's detail, choose **Void / refund…** and give a reason. In one transaction, all items go back into stock, the invoice is marked VOID (it stays in history and still prints with a VOID banner), the stock ledger records the return, and the audit log records who voided it and why. The screen tells you how much to refund in cash and/or on the card machine.

**Reports (admin):** set the **event first day** and **number of days** in Settings first.
- A table with one row per event day: invoices, items, gross, discounts, net sales, cash, card and voids, plus a total row. Tap a day for its details and **top products** (or choose *Whole event*).
- **End-of-day cash count:** *expected in drawer* = opening cash (from Settings) + cash taken that day (cash sales net of change, plus the cash part of split payments). Enter the counted cash to see the difference (over/short) and save it. Saved counts are listed.
- **Cash by cashier:** one row per cashier for the chosen day: invoices, sales, card, cash taken, float given, cash collected, and **still to collect** (float + cash sales − collected).
  - **Give float:** records change money handed to a cashier. It's added to what they owe.
  - **Collect cash:** shows what the cashier should hand over. Enter what you counted to see *exact / short / over*, then save. Collect as many times a day as you like; every collection keeps its expected amount and difference. **Show cash log** lists all floats and collections. Export CSV is available.
  - Card sales are settled by the bank, so they're never collected from the cashier.
  - Every cashier sees **My sales today** at the top of History, with their *cash to hand over*. They see only their own figures.
- Offline sales count on the day they were actually made (the device's time), even if they sync later.
- **Export:** Sales CSV (one row per invoice), Sales items CSV (one row per product line), Stock movements CSV, and a **Full backup** (all tables as JSON). Download a backup at the end of every day.

Testing tip: run `select public.generate_fake_sales(50, 4);` in the SQL Editor, then open Reports. The days, cash and card split, top products and history should all be filled in. Then try voiding one sale and check its stock went back up on the Stock page.

## 8. Offline & PWA (Stage 5)

**Install it like an app:** in Chrome on the tablet, open the site and use *Install app* / *Add to Home screen*. The whole app is cached by a service worker, so it opens instantly and keeps working on poor wifi. When a new version is deployed, an **Update now** button appears; the app never reloads on its own in the middle of a sale.

**Selling offline:**
- The header shows **● Online** or **● Offline**, with a red strip under it while offline. Offline is detected from the browser *and* from failed requests (wifi connected but no internet counts as offline).
- The product list and stock come from this device's last known copy. Stock already sold offline on this device is subtracted, so you can't sell more than you have.
- **Complete sale** stores the sale on the device (written synchronously, so it survives reloads and closed tabs) **before** showing it as done. The screen shows *Saved on this device (offline)* with a temporary number like **T-N93V-0001** instead of a green invoice number. The receipt prints with that number.
- If the server can't be reached while online (timeout, flaky wifi), the sale is queued the same way. Each sale keeps its own id, so if it actually did reach the server, syncing returns the existing invoice and never records it twice.

**Syncing:** automatic when the connection returns, plus every 20 seconds while sales are waiting. The amber **N to sync** badge counts down, and a toast says e.g. *T-N93V-0001 synced as invoice #57*. Tap the badge to see the queue, **Sync now**, reprint, or **Download this device's data** (a backup of everything waiting).

**Needs attention:** if the server refuses a queued sale (e.g. another till sold the last units while this one was offline), it gets a red **needs attention** badge and is never thrown away silently. An admin fixes the stock and presses **Retry**. **Discard** (admin only) downloads a copy first.

**Testing it:** in Chrome DevTools → Network, choose *Offline*. Make a sale; you should see the temporary number and the "1 to sync" badge. Switch back to *No throttling*; within a few seconds it syncs and appears in History with a real invoice number, and the stock updates on every device.

## 9. Deploy to GitHub Pages (Stage 6)

`.github/workflows/deploy.yml` builds and deploys on every push to `main`. It runs `npm ci`, then the database tests (a failure stops the deploy), then the build with base path `/<repo-name>/`, then publishes `dist/` to GitHub Pages.

One-time setup:
1. **Repository secrets** (GitHub → Settings → Secrets and variables → Actions → *New repository secret*):
   - `VITE_SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = the anon / **publishable** key (never the service_role / secret key)

   Or with the GitHub CLI:
   ```bash
   gh secret set VITE_SUPABASE_URL --body "https://<project-ref>.supabase.co"
   gh secret set VITE_SUPABASE_ANON_KEY --body "<publishable key>"
   ```
2. **Turn on Pages:** GitHub → Settings → Pages → *Build and deployment* → Source: **GitHub Actions**. With the CLI: `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`.
3. **Push:** `git push -u origin main`. Watch it under the *Actions* tab. The app goes live at `https://<owner>.github.io/<repo>/`.

Later updates: just push to `main`. Open tills show **Update now** once the new version is downloaded.

**Before the event:**
1. Run `supabase/reset_test_data.sql` to remove all test sales, put the stock back, and restart invoices at #1.
2. Import the real products (Stock → Import CSV), set the event start date and opening cash in Settings, and create staff accounts.
3. On each tablet: open the site, log in, *Install app*, then Settings → printer → **Print test receipt**.
4. Make one real test sale per till, void it, and confirm it shows in Reports.

### What's enforced in the database (not just hidden in the UI)

- Anonymous visitors can't read or write anything.
- Cashiers see only **their own** sales (History shows “My sales”), have no Stock tab, and can't change products, prices or stock. Admins see everything.
- Only an **admin** login can run a print station; cashiers can only send print jobs to it.
- Only admins can void (`void_sale`: stock restored, ledger + audit written) or see reports and cash counts.
- A sale can only be recorded by `create_sale`, which locks the products, re-checks stock, recalculates every total, discount and change amount on the server, and takes the next gapless invoice number, all in one transaction.
- **Nobody can edit `stock_qty` directly, admins included.** Stock only changes through `adjust_stock`, `import_products` and (from Stage 2) the sale and void functions. Each of those writes a row to `stock_movements`, so the stock ledger is always complete.
- Product edits, imports and staff role changes are recorded in `audit_log` (admin-only).
- `npm run test:db` checks all of the above.

## Project layout

```
supabase/migrations/   SQL to run in order (schema, RLS, functions)
supabase/seed.sql      sample products
tests/db/              database tests (PGlite)
src/lib/               supabase client, money (Rs formatting), csv, time, errors
src/auth/              login, session/profile, role guard
src/components/        layout + shared touch-friendly UI
src/features/products/ stock list, add/edit, adjust, CSV import
src/features/staff/    staff roles
```

## Conventions

- **Money** is stored as whole rupees (integers) and displayed as `Rs 1,250`.
- **Time:** timestamps are stored in UTC. Each device shows times and per-day reports in its own system timezone.
- **Routing** uses `/#/…` URLs, so refreshing a page on GitHub Pages never gives a 404.
