# Job orders, attendance and engineer bonus — design

Owner conversation 2026-11-23. Approach A (owner-approved): a new, separate "Job orders" area; nothing existing changes.

## 1. Why
Misr Motors' maintenance engineers visit customers (mostly compressors, air machines, fire-fighting pumps). The owner
wants a fair monthly bonus that rewards: attendance discipline, fixing right the first time, fixing fast, the real
effort of each job (jobs are not equal), travel, working late, and buying supplies for a job. He also wants every job's
real cost (parts bought, parts from stock, time) and a performance page per engineer in HR. With this the ERP covers
all of the company's work.

Today: a customer tells the maintenance head (75, does not use computers) about a fault; the head phones an engineer;
the engineer visits and fills a paper report — fixed, or not fixed + parts needed; parts are bought; he returns another
day. Engineers are nearly illiterate and cannot use apps beyond taking a photo through the existing worker link (the
MINV booklet photo link). Some start the day at the office, some go from home straight to a customer.

## 2. Goals / non-goals / anti-goals
Goals
- G1 Record every maintenance job and every visit, without engineers or the head using a computer.
- G2 Record attendance for office staff and field engineers from a fingerprint device (Excel import until the device is
  connected).
- G3 After 1–2 months of real data, set fair points/normal times and calculate a monthly bonus per engineer.
- G4 Per-job cost (supply purchase orders + stock parts) and profit (against the job's MINV invoice).
- G5 HR performance page with monthly charts per engineer.
Non-goals (this project): customer portal (later stage); GPS tracking; engineer-facing app beyond the photo link.
Anti-goals: anything that changes live invoices, orders, stock, MINV numbering or the existing work-order screens;
an engineer punished for things outside his control (traffic, customer under-describing the fault, waiting for parts).

## 3. Hard constraints
- Built on its own branch; merged only after owner approval; when live, visible only to CEO/admin until the owner opens it
  to others (a setting).
- Database: new tables only (additive SQL, RLS on, no policies, service key). No existing table is altered except
  optional nullable link columns if unavoidable (none planned).
- Working week Saturday–Thursday, hours 09:00–17:00, late after 09:15 (15 minutes forgiven). Friday and official holidays
  are non-working days.
- Arabic-first wording for anything the office prints or engineers see.

## 4. Stages
1. Record (build now): job orders, job cards + photos + office confirmation, travel zones, supply runs → purchase orders,
   attendance (import + rules), reports. No bonus money.
2. Calibrate: owner and Claude review 1–2 months of data; set job-type points, size multipliers, normal times, zone
   points, overtime rate, first-time-fix window.
3. Pay: monthly bonus calculation (draft → owner approves), HR performance charts, then the customer portal.
This design covers Stage 1 fully and fixes the Stage 2/3 rules' shape so Stage 1 records what they need.

## 5. Stage 1 — what gets built
### 5.1 Job orders (new area "Job orders / أوامر الشغل", CEO/admin/accountant)
- A job: number (JOB-26xxxx), customer, site (customer branch/address), machine (free text, e.g. "Compressor #2"),
  reported problem (what the customer said), status, optional link to a sales order and to MINV invoice(s), created by.
- Statuses: Open → In progress (first visit recorded) → Waiting for parts → Fixed (closed) | Cancelled.
- A job has many visits. A job is closed when a visit is confirmed "fixed".
- Repeat detection: a new job for the same customer + same machine within N days (setting, default 30) after a job
  closed as fixed is flagged "repeat of JOB-…".
- The office opens the job when the customer calls/writes (the head keeps phoning engineers). The office also records
  which engineers were sent, but the job card is the source of truth for who went.

### 5.2 Job card (printed, like the MINV booklet)
- Printable A5/A4 form, Arabic, pre-numbered per job (job number + QR), printed from the job screen; also a blank card
  for jobs opened after the fact.
- Boxes: visit type (customer visit / شراء مستلزمات supply run), engineers on this visit (names/signatures, up to 4),
  arrival time, finish time, what was found, what was done, fixed yes/no, parts needed, customer name + signature + stamp.
- The engineer photographs it through his existing worker link (same page as MINV photos; a choice "job card" vs
  "invoice"). Supply-run cards are photographed together with the shop receipt.

### 5.3 Office confirmation ("Job cards to confirm")
- The photo is read automatically (existing photo reader) into a draft: job (from QR), engineers, times, found/done,
  fixed, parts needed.
- The office person checks it against the photo, corrects misreads, and picks: job type (list: compressor, air machine,
  fire pump, + editable list) and size as found (small / medium / large). Confirm.
- On confirm: the visit is saved; the job status moves; times feed attendance (5.6).
- Supply run: the receipt becomes a draft purchase order (supplier = the shop, lines + prices read from the receipt,
  payment = cash), linked to the job; the office confirms it like any PO (existing PO/AP flows unchanged).

### 5.4 Travel zones
- Each customer site has one zone: قريب near / متوسط medium / بعيد far / خارج القاهرة out of Cairo. Set once by the office
  (on the site/customer). Each visit records the zone of its site.

### 5.5 Job cost and profit
- Job cost = supply POs linked to the job + parts taken from stock for the job (at stock cost) (+ later engineer time).
- Job revenue = linked MINV invoice(s) (and the linked sales order share if any).
- Shown on the job screen; a monthly job-profit report.

### 5.6 Attendance
- Employees (existing HR employees) get a group: office or field.
- Data: fingerprint punches. Stage 1: Excel/CSV import of the device export (employee code, date-time); later the
  device pushes directly (ADMS) once a capable model is installed (separate small task).
- Daily record per employee:
  - Office: first punch = in, last punch = out; late if in after 09:15; absent if no punch on a working day.
  - Field: start = earliest of office punch-in and first job-card arrival (or supply-run start); end = latest of office
    punch-out and last job finish; late if start after 09:15; absent if no punch and no job card. Going from home to a
    customer is not late when he arrived on time.
  - Overtime minutes: field work (job visits / supply runs) outside 09:00–17:00 or on Friday/holiday.
- Office can add a manual note/excuse to a day (leave, sick, permission); excused days don't count as absent.

### 5.7 Reports (Stage 1)
- Per engineer per month: jobs, visits, hours on site, zones, supply runs, overtime minutes, repeats, attendance
  (present / late / absent / excused).
- Per job type: count, average on-site time by size, share needing a second visit — the data Stage 2 calibrates from.

## 6. Stage 2/3 rules (shape fixed now, values set later)
- Job points = type points × size multiplier, earned once when the job closes as fixed; split equally among all engineers
  who worked any visit of the job.
- Travel points per visit by zone; each engineer on the visit gets them in full.
- Speed: on-site time of the job vs the normal time for its type+size → a % adjustment; waiting-for-parts time never counts.
- First-time fix: a repeat within N days removes/reduces the original job's points.
- Overtime: field work outside hours = extra points at a rate (e.g. 1.5×; Friday/holiday 2×), per engineer.
- Supply runs count as working time; optional small points.
- Attendance: late days / absences reduce the bonus by rule (values Stage 2).
- Monthly bonus = points × value per point (+/− attendance), calculated as a draft, owner approves, then (optionally) added
  to salary payments.
- HR performance page: monthly charts (jobs by type, points split, first-time-fix rate, attendance, bonus vs previous
  months and team average).

## 7. Approaches considered
- A (chosen): new separate Job orders area with new tables, linked to customers / MINV / POs / stock / optional SO;
  old work-order screen untouched (hide later).
- B: rebuild the existing work-order flow (CEO-only, hangs off a sales order, one report, no visits/engineers/times) —
  rejected: changes live tables/screens and doesn't fit the real process.

## 8. Decided by the owner
Separate from sales orders (optional link only); four zones named above; split job points equally; hours 09:00–17:00,
Sat–Thu, 15 min grace; supply runs count as work and link to purchase orders; working late earns extra; difficulty
judged after the job from what was found; no bonus money before real data.

## 9. Left to the builder
Table design, numbering format details, screen layouts (keep them as simple as the MINV photo screens), the photo
reader prompt for job cards, Excel import column mapping (configurable), which existing employee field holds the device
code (add one if missing, in the new tables).

## 10. Builder-check answers (Claude's calls unless marked)
1. A fault after a job closed as fixed = a NEW job flagged "repeat of JOB-…" (old job not reopened). If the office sees on
   a card that it was not really fixed, they mark that visit "not fixed" and the job stays open.
2. Attendance is computed from punches + CONFIRMED job cards and recomputed whenever a card is confirmed later, so a late
   confirmation never leaves an "absent" day. Unconfirmed cards do not count yet.
3. OPEN — owner to decide: whether time after hours with no job/supply run (late punch-out, office staff staying late)
   counts as overtime. Claude's proposal: only job/supply-run time after hours counts; office/late time counts only when
   approved for that day.
4. New "customer sites" table (many per customer): name/branch, address, zone, contact. Jobs reference a site.
5. "Waiting for parts" is set automatically by a confirmed visit "not fixed, parts needed" and ends at the next visit;
   both timestamps are stored.
6. Engineers on a card are matched to HR employees (strict link). An unmatched name blocks confirmation until the office
   picks the person.
7. New small "official holidays" list maintained by the office; Fridays always off.
8. One setting "job orders live": off = CEO/admin only; on = accountant too, and the "job card" option appears on the
   engineers' photo link.

## 11. REVISED FLOW (owner, 2026-11-23/24) — supersedes 5.1–5.3 where they differ
- The MAINTENANCE MANAGER is the hub (not the office): he receives the request, uses two NEW pre-numbered carbon
  booklets, and photographs the filled pages through his existing photo link (as with MINV pages today).
  - JOB CARD booklet (customer-facing; may be photographed and sent to the customer): printed number (+ QR as a reading
    aid), customer, branch/location, machine, optional sales order number, ZONE tick boxes (قريب / متوسط / بعيد / خارج
    القاهرة), engineers on the visit, date, arrival/finish times, problem found, a LARGE lined "work done" area, fixed /
    not fixed, parts installed or needed WITHOUT prices or suppliers, customer name + signature + stamp.
  - PURCHASE SLIP booklet (office only, never sent to the customer): own printed number, a box for the job-card number,
    rows of item / shop or supplier / price / "from stock" tick, shop receipt stapled.
- A job is created automatically when its first job-card page photo arrives (job number = the booklet page number);
  later pages for the same job number attach to it. The office can also open a job by hand. Jobs never require a sales
  order (optional link only).
- Zone: ticked on the card; the system remembers it per customer site so later cards need not repeat it.
- The office only checks the read-out and presses Confirm. Job difficulty = real hours on site (no size picking).
  Job type chosen once per job.
- Purchase slip rows become job expenses on the job (cost per job); "from stock" rows take the item out of stock at stock
  cost. (Whether they also create formal POs: builder proposes; owner wants the simplest path.)
- Invoices stay on the existing MINV booklet flow; a job's MINV can be linked to the job for profit per job.
- The existing MINV booklet is unchanged.
