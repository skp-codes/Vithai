# Vithai

*Vithai* (விதை, "seed"): plant a little every month and watch it grow.

Vithai is a household investment planner for Indian mutual funds, gold ETFs and Nifty 50 stocks:

1. **Setup.** Enter your monthly amount and split it across large cap, mid/small cap, debt, international, gold and Nifty 50 stocks. You can exclude fund houses (for example ICICI or SBI).
2. **Fund dashboard.** Every Direct-Growth fund in each slot is ranked on the metrics you choose. Defaults are long-term returns, Sharpe/Sortino, drawdown and cost. You can tick, untick and weight any metric, pin a fund, or reset to the Vithai default.
3. **Monthly plan.** Each person has their own plan for each month. Pick a month to see what's due: the funds in each section (several per section if you like), the Nifty 50 shares due that month, and your US basket. A new month starts as a draft copied from last month; add, drop or change any fund or amount just for that month. Record what you actually bought, and edit or delete any purchase later (deleting asks first).
   - **Nifty 50 plan** (like the Excel planner): whole shares on a schedule, e.g. *HDFCBANK 1 every month, ICICIBANK 1 every 2 months, ULTRACEMCO 1 every 24 months*, worked out from your monthly budget and index weights, with first-buy months staggered so each month costs about the same. Every stock's shares, frequency and first month are editable. **Full schedule** shows the next 12 months as a grid and downloads it as Excel. Fractional monthly or weekly buying by index weight is also available.
4. **Portfolio.** Shows invested amount, current value, gain, XIRR, and actual versus target allocation.
5. **Household.** Works like MealPilot: one person starts a household and others join with an invite code and admin approval. Each member decides whether others in the household can see their portfolio.
6. **Indian stocks and US stocks dashboards.** Built from your Tickertape stock screener exports (about 250 columns for India and 75 for the US). Rank stocks on any metrics with your own weights and directions, limit to the top N by market cap or to chosen sectors, and open any stock to see every field.
7. **Optional US stocks slot.** Turn it on in Setup, set the rupee–dollar rate, and add stocks to your US basket from the US dashboard. The monthly plan splits the slot across the basket, and the portfolio values the holdings in rupees.
8. **Data page.** A **Vithai export** bookmark exports *every* column from each Tickertape screener. Tickertape caps each export at 45 columns, so the bookmark makes several files. Drop all the files on the Data page and Vithai joins them back together.

## How the data works

| Data | Source | Freshness |
|---|---|---|
| NAVs, returns (1Y, 3Y, 5Y, 10Y CAGR), 3Y rolling returns, volatility, Sharpe, Sortino, max drawdown, % below ATH, gold ETF tracking error | Computed from each scheme's full daily NAV history from [mfapi.in](https://www.mfapi.in/), which mirrors AMFI | Twice a day, via a GitHub Action |
| Expense ratio, AUM, exit load (key funds and all major gold ETFs) | Researched values in `data/seed-facts.json` | When updated in the repo |
| Expense ratio, AUM, exit load, alpha, PE, YTM, holdings mix (everything else) | Your **Tickertape screener export**, uploaded on the Fund dashboard | Whenever you upload, about monthly |
| Overrides (expense ratio, subscription status such as "closed to new SIPs") | Edited in the app by a household admin | Any time |
| Indian and US stock data | Tickertape stock screener exports, loaded on the Data page; stored compressed in Cloudflare KV | Whenever you load new exports |
| Nifty 50 weights and prices | Seeded on 2 Nov 2026; update on the Monthly plan page by pasting from NSE | Before you buy |

Priority when values clash: **edited in app > researched > Tickertape**. Tickertape exports don't separate Direct and Regular plans and use 0 for missing values, so they only fill gaps.

Tickertape and Kite are not connected automatically. Tickertape has no public API, and Kite logins can only be used by apps on Zerodha's paid Kite Connect API. You can add Kite Connect later to import holdings.

## Architecture

- **Cloudflare Worker** (`src/worker.js`) serves the static front-end from `public/` and the JSON API under `/api/*`.
- **Cloudflare D1** (SQLite) stores users, households, sessions, settings, purchases, the fund universe and metrics, and facts.
- **GitHub Action** (`.github/workflows/refresh-data.yml`) runs `scripts/refresh.mjs` twice a day. It downloads NAV histories, computes metrics and posts them to `/api/admin/ingest` using a shared secret.
- The front-end is plain JavaScript modules with no build step. The metrics and ranking code in `public/js/` is shared by the browser and the refresh script.

## Deploy (first time)

You need a free Cloudflare account and Node.js 20+. On Windows PowerShell, use `npx.cmd` instead of `npx`.

```powershell
git clone https://github.com/skp-codes/Vithai.git
cd Vithai
npm install
npx wrangler login

# 1. Create the database, then paste the printed database_id into wrangler.toml
npx wrangler d1 create vithai

# 2. Create the store for Tickertape data, then paste the printed id into wrangler.toml (kv_namespaces)
npx wrangler kv namespace create DATA

# 3. Create the tables and seed the Nifty 50 list
npx wrangler d1 migrations apply vithai --remote

# 4. Set the secret the data refresh uses (any long random string; keep a copy for step 5)
npx wrangler secret put INGEST_TOKEN

# 5. Deploy. This prints your https://vithai.<you>.workers.dev address
npx wrangler deploy
```

6. **Add the data refresh secrets on GitHub.** In the repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `VITHAI_URL`: your site address from step 4, e.g. `https://vithai.<you>.workers.dev`
   - `INGEST_TOKEN`: the same value as in step 3
7. **Load fund data now.** Under **Actions → Refresh fund data → Run workflow**. It takes about 3–5 minutes. After that it runs on its own twice a day.
8. Open the site, choose **Start a household**, and you're the admin.
9. On the **Data** page, drag **Vithai export** to your bookmarks bar, run it on each Tickertape screener, and load the downloaded files.

**Updating later:** `wrangler.toml` holds your own database and KV ids, so keep your edits when pulling:

```powershell
git stash
git pull
git stash pop
npx wrangler d1 migrations apply vithai --remote   # only if migrations/ changed
npx wrangler deploy
```

## Backups and deleting data

On the **Household** page anyone can download a full backup of their data (.json) or their purchases, plans and allocation as an Excel file. The household admin can also download a backup of the whole household.

**Delete all my data** / **Delete all household data** need you to download a backup first and type DELETE. If email is set up, Vithai also emails the backup to you before deleting. To set up email (free with [Resend](https://resend.com), 3,000 emails a month):

```powershell
npx wrangler secret put RESEND_API_KEY          # paste the API key from resend.com
# optional, once you've verified your own domain in Resend:
npx wrangler secret put EMAIL_FROM              # e.g. Vithai <vithai@yourdomain.com>
```

Without a verified domain, Resend's test sender can only email the address you signed up to Resend with.

## Importing Tickertape data: column mapping

The import adapts to whatever columns your files have:

- **Key fields.** For each export type, Vithai lists the fields it relies on: name, ticker, sector, market cap, price, the default ranking metrics, and for funds the expense ratio, AUM, exit load and so on. It shows which column each was matched to and whether it was found, is missing, or is required. You can pick a different column (for example after Tickertape renames one) or choose "not in my file".
- **Rename or leave out any column.** Under "All columns", give a column a different name in Vithai or untick it to drop it.
- **Remembered per household.** Your choices are saved and reused on the next import. If a column you used last time has disappeared or been matched differently, the import tells you.
- **Missing data never breaks ranking.** A missing metric is skipped, and funds or stocks are scored on the rest. The dashboards show what share of rows have each ticked metric and warn when one has no data. If a saved metric isn't in the latest import, you can remove it or point it at another column.

## Household data

Everything you import or edit belongs to your household: the Tickertape datasets, column mapping, fund-fact edits and Nifty 50 weights and prices. Every member sees the latest import, and other households never see it. The fund universe and NAV-based metrics from AMFI are public data and shared by all.

## Tickertape export bookmark

`public/tools/tickertape-export.js` runs in your own signed-in Chrome on a Tickertape screener page. It reads the full filter list, splits it into parts of at most 45 columns (Tickertape's export limit), and for each part ticks those filters and clicks Tickertape's own **Export** button. Files are named `vithai-<mf|in|us>-<date>-partNofM.csv`. The first time, Chrome asks to allow multiple downloads from tickertape.in; choose Allow. If Tickertape changes its page layout, this script is the one place to update.

Tickertape's terms prohibit reproducing the (S&P-licensed) data without permission, so keep Vithai private to your household; don't make it public or commercial with this data in it.

### Custom domain

Add your domain to Cloudflare (Websites → Add a site, then switch the nameservers at your registrar). Then go to **Workers & Pages → vithai → Settings → Domains & Routes → Add → Custom domain** and enter e.g. `vithai.yourdomain.com`. Cloudflare issues the HTTPS certificate automatically. Update the `VITHAI_URL` secret on GitHub to the new address.

## Local development

```powershell
npm install
npx wrangler d1 migrations apply vithai --local
echo INGEST_TOKEN=local-test-token > .dev.vars
npx wrangler dev                 # http://localhost:8787
node tests/make-fixture.mjs      # synthetic data for 18 funds -> data/snapshot.fixture.json
curl -X POST http://localhost:8787/api/admin/ingest -H "authorization: Bearer local-test-token" -H "content-type: application/json" --data @data/snapshot.fixture.json
npm test                         # metrics, ranking and name-matching tests
```

To test against real data locally, run `node scripts/refresh.mjs --out data/snapshot.json` and post that file the same way.

## Default ranking criteria

Each fund's score (0–100) is the weighted average of its percentile on each ticked metric, among eligible funds in the slot. Missing values are skipped and never count as "best". Funds with less than half the criteria data rank below the rest.

| Slot | Eligible | Metrics (weight) |
|---|---|---|
| Large cap | 5+ years old | CAGR 5Y (1.5), 10Y, 3Y, 3Y rolling avg, Sharpe (1.5), Sortino, max drawdown, expense ratio |
| Mid/small | 5+ years, Mid Cap (tick Small Cap to include) | same as large cap |
| Debt | 5+ years, Corporate Bond (tick Banking & PSU to include) | CAGR 3Y (1.5), 5Y, 1Y (0.5), Sharpe (1.5), max drawdown, volatility (0.5), expense ratio (1.5) |
| International | 3+ years | CAGR 3Y (1.5), 5Y, Sharpe (1.5), Sortino, max drawdown, expense ratio |
| Gold ETFs | 3+ years | expense ratio (2), tracking error (2), AUM, CAGR 3Y (0.5) |

Sharpe and Sortino use a 6.5% risk-free rate over the last 3 years. Max drawdown is over the last 5 years.

*Not financial advice. Rankings are backward-looking, and past performance does not guarantee future returns.*
