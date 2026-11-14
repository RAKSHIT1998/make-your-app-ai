/**
 * Business software kits: ready-made blueprints for common small-business systems. Picking one fills the Create box
 * with a precise brief for a team-only Full-stack App; the customer edits it (their business name, products, rules)
 * before building. Each brief stays within what the platform's backend really supports (collections, team accounts,
 * shared or permanent records, no server code, no payments or email inside the app).
 */
export interface BusinessKit {
  id: string;
  name: string;
  /** lucide icon name, resolved by the web app */
  icon: 'contact' | 'shopping-cart' | 'boxes' | 'calendar-clock' | 'receipt' | 'life-buoy' | 'plane' | 'utensils' | 'dumbbell' | 'wrench' | 'bed';
  tagline: string;
  forWho: string;
  features: string[];
  prompt: string;
}

const TEAM = 'It is used only by our staff: make it a team-only app (only people I add can sign in), with a clear team sign-in screen.';
const COMMON = 'Every list needs search, the filters named, empty states and loading states. Show money with the currency symbol and 2 decimals. Mobile-friendly: staff will use it on phones and tablets.';

export const BUSINESS_KITS: BusinessKit[] = [
  {
    id: 'crm', name: 'CRM', icon: 'contact',
    tagline: 'Leads, deals, tasks and calls in one place',
    forWho: 'Agencies, consultants, real estate, B2B sales teams',
    features: ['Leads that convert into deals', 'Deal board with stage probability', 'Tasks, call logs and notes on one page', 'Forecast, win rate and lost reasons'],
    prompt: `A CRM for my sales team. ${TEAM}
Data:
- leads (number like LEAD-0001, name, company, job title, email, phone, source: website/referral/walk-in/social/ads/event/other, temperature: hot/warm/cold, status: new/contacted/qualified/unqualified/converted, owner email, notes)
- deals (number like DEAL-0001, title, organization, contact name, email, phone, value, stage: qualification/demo or meeting/proposal/negotiation/won/lost, probability % that follows the stage (10/30/50/70/100/0) but can be changed, expected close date, next step, owner email, lost reason: price/competitor/no budget/no response/timing/other, lead number it came from)
- organizations (name, industry, website, size: 1-10/11-50/51-200/201+, city)
- tasks (title, related to: lead or deal number, assignee email, priority: low/medium/high, status: to do/in progress/done/cancelled, due date)
- call logs (related to: lead or deal number, type: incoming/outgoing, outcome: connected/no answer/busy/voicemail, duration in minutes, notes, date) — permanent
- notes (related to: lead or deal number, text, author email) — permanent
- stage changes (deal number, from stage, to stage, by email, date) — permanent; write one every time a deal's stage changes
Screens: a dashboard with open pipeline value, weighted forecast (value × probability) for this month, deals won and lost this month, win rate, top lost reasons, and my tasks due today or overdue; leads list with filters by status, temperature, source and owner, and a "Convert to deal" action that creates the deal (and the organization if new), marks the lead converted and links them; a deal board with one column per stage showing count and total value, and buttons to move a deal forward or back (asking for a lost reason when moved to lost); a single deal or lead page with details on top and tabs for activity (calls, notes and stage changes in time order), tasks, and quick actions to log a call, add a note or create a task.
${COMMON}`,
  },
  {
    id: 'pos', name: 'Point of sale', icon: 'shopping-cart',
    tagline: 'Fast billing at the counter, with stock that updates itself',
    forWho: 'Kirana and retail shops, cafés, salons, pharmacies (non-prescription)',
    features: ['Quick product search and cart', 'Discount, tax and change due', 'Sales history and daily totals', 'Stock reduced on every sale'],
    prompt: `A point-of-sale (billing counter) app for my shop. ${TEAM}
Data: products (name, SKU or barcode text, category, price, tax percent, active yes/no); sales (bill number like BILL-0001, date, items as text summary, subtotal, discount, tax, total, payment method: cash/UPI/card, amount received, change, cashier email) — sales are permanent; stock movements (product name, SKU, change as a number: negative for sales, positive for restock, reason: sale/restock/correction/damage, date) — permanent.
Screens: a billing screen with product search by name or SKU, tap to add to cart, quantity +/- , line totals, discount (amount or %), tax from each product's tax %, grand total, payment method, amount received and change due; "Complete sale" saves the sale, then one stock movement per item, and shows a receipt view on screen. A products screen to add/edit products with current stock (sum of movements) and a low-stock list (5 or fewer). A sales screen with today's total, number of bills, totals by payment method, and a searchable list of bills by date.
${COMMON}`,
  },
  {
    id: 'inventory', name: 'Inventory', icon: 'boxes',
    tagline: 'Know what you have, where it is, and what to reorder',
    forWho: 'Warehouses, distributors, manufacturers, shops with stockrooms',
    features: ['Items, locations and suppliers', 'Stock in, out and adjustments as a ledger', 'Low-stock and reorder list', 'Stock value'],
    prompt: `An inventory management app for my business. ${TEAM}
Data: items (name, SKU, category, unit: piece/kg/litre/box, cost price, sale price, reorder level, supplier name); locations (name, notes); suppliers (name, contact person, phone, email); stock movements (item SKU, item name, location, quantity change (+ in, - out), type: purchase/sale/transfer/adjustment/return, reference text, date, by email) — movements are permanent.
Screens: a dashboard with total items, total stock value at cost, and a reorder list (items at or below reorder level, with supplier); items list with current stock per item (sum of movements) and per location, search and category filter; an item page with its movement ledger; forms for "Stock in", "Stock out" and "Adjust" that create movements (stock out cannot exceed what's available — check before saving); suppliers list.
${COMMON}`,
  },
  {
    id: 'appointments', name: 'Appointments', icon: 'calendar-clock',
    tagline: 'Bookings, staff schedules and no double-booking',
    forWho: 'Salons, spas, tutors, consultants, repair shops',
    features: ['Services with duration and price', 'Day view per staff member', 'Clash check before booking', 'Status: booked, done, no-show, cancelled'],
    prompt: `An appointment booking app for my front desk and staff. ${TEAM}
Data: services (name, duration in minutes, price, active); staff (name, email, working days as text, active); clients (name, phone, email, notes); appointments (client name, client phone, service, staff name, date, start time as HH:MM, duration, price, status: booked/completed/no-show/cancelled, notes).
Screens: a day view (pick a date) showing each staff member's appointments in time order with free gaps; a "New appointment" form that refuses to save if the staff member already has an overlapping appointment that day (check before saving and explain the clash); quick status buttons (completed, no-show, cancel); clients list with search and each client's appointment history; services and staff screens; a summary of today's bookings, completed revenue today and this month, and no-show count.
${COMMON}`,
  },
  {
    id: 'invoices', name: 'Invoices & payments', icon: 'receipt',
    tagline: 'Quotes, GST-ready invoices and who still owes you',
    forWho: 'Freelancers, agencies, contractors, wholesalers',
    features: ['Customers and invoice line items', 'Tax and totals calculated for you', 'Payments recorded against invoices', 'Outstanding and overdue amounts'],
    prompt: `An invoicing app for my business. ${TEAM}
Data: customers (name, company, email, phone, billing address, GSTIN optional); invoices (number like INV-0001, customer name, issue date, due date, line items as text lines "description | qty | rate | tax %", subtotal, tax total, grand total, status: draft/sent/partly paid/paid/cancelled, notes); payments (invoice number, date, amount, method: bank transfer/UPI/cash/cheque/card, reference) — payments are permanent.
Screens: a dashboard with total outstanding, overdue invoices (past due date and not fully paid), and collected this month; invoices list with status filter and search; an invoice editor where staff add line items in a table (description, qty, rate, tax %) and the app computes line totals, subtotal, tax and grand total; an invoice view laid out like a printable invoice with my business details at the top (placeholders I can edit) and a "Record payment" form; amount paid and balance due computed from payments; customers list with each customer's balance.
${COMMON}`,
  },
  {
    id: 'helpdesk', name: 'Helpdesk', icon: 'life-buoy',
    tagline: 'Customer issues tracked from new to solved',
    forWho: 'Service businesses, SaaS support, IT teams, maintenance desks',
    features: ['Tickets with priority and status', 'Assignee and replies timeline', 'Queues: mine, unassigned, overdue', 'Resolution counts'],
    prompt: `A helpdesk / ticketing app for my support team. ${TEAM}
Data: tickets (number like TKT-0001, customer name, customer email, subject, description, category: billing/technical/delivery/other, priority: low/normal/high/urgent, status: new/open/waiting on customer/resolved/closed, assignee email, due date); replies (ticket number, author email, message, internal note yes/no, date) — replies are permanent.
Screens: queues as tabs — My tickets, Unassigned, Urgent, Overdue (due date passed and not resolved), All; a ticket page with details, a timeline of replies (internal notes highlighted), a reply box, and buttons to assign to me, change status and priority; a "New ticket" form; a summary with open tickets by priority and tickets resolved this week.
${COMMON}`,
  },
  {
    id: 'leave', name: 'HR & leave', icon: 'plane',
    tagline: 'Staff directory, leave requests and approvals',
    forWho: 'Any business with employees',
    features: ['Employee directory', 'Leave requests and approve/reject', 'Leave balances per type', 'Who is off today'],
    prompt: `An HR app for staff directory and leave management. ${TEAM}
Data: employees (name, work email, phone, department, role title, joining date, annual leave allowance in days, sick leave allowance in days, active); leave requests (employee email, employee name, type: annual/sick/unpaid/other, from date, to date, days, reason, status: pending/approved/rejected, decided by email, decision note).
Screens: "Who's off today" and upcoming approved leave at the top; a request form where staff pick dates and type and the app counts the days; "My requests" for the signed-in person; an approvals list of pending requests with approve/reject and a note; employee directory with search and department filter; each employee's balances (allowance minus approved days this year) per leave type. Do not store salary, ID numbers, bank details or medical details.
${COMMON}`,
  },
  {
    id: 'restaurant', name: 'Restaurant orders', icon: 'utensils',
    tagline: 'Tables, kitchen tickets and bills in one flow',
    forWho: 'Restaurants, cafés, cloud kitchens, food trucks',
    features: ['Live table board', 'Items with add-ons and special requests', 'Kitchen screen by ticket', 'Split bills, voids with a reason, daily sales'],
    prompt: `A restaurant ordering app for waiters, the kitchen and the cashier. ${TEAM}
Data:
- tables (number, area: indoor/outdoor/terrace/private, seats, status: free/occupied/bill requested/needs cleaning)
- menu items (name, category: starters/mains/breads/rice/drinks/desserts/other, price, veg yes/no, available yes/no, add-ons as text like "extra cheese +40, no onion +0")
- orders (number like ORD-0001, table number or "Takeaway"/"Delivery", guests count, waiter email, status: open/billed/paid/cancelled, opened at time, subtotal, discount, service charge, tax, total, payment method: cash/UPI/card/split, notes)
- order lines (order number, item, quantity, chosen add-ons, special request, unit price, line total, kitchen status: new/preparing/ready/served, sent at time) — lines can be marked void only with a reason (never deleted)
- payments (order number, method, amount, date) — permanent; a bill can have several payments to split it
Screens: a table board showing every table's status and open order total, tap a table to open or continue its order; an ordering screen with menu by category (unavailable items greyed out), add-ons and a special-request note per item, and "Send to kitchen" which sets the new lines to new; a kitchen screen showing new and preparing lines grouped by order as large tickets, oldest first, with one-tap "Start" and "Ready", refreshing every 15 seconds; a billing screen that totals the order, applies discount, service charge and tax, takes one or more payments until the balance is zero, then frees the table (status needs cleaning); a menu screen to edit items and toggle availability; today's sales, covers, average bill, top 5 items and void count.
${COMMON}`,
  },
  {
    id: 'hotel', name: 'Hotel front desk (PMS)', icon: 'bed',
    tagline: 'Reservations, room board, check-in to check-out',
    forWho: 'Independent hotels, guesthouses, homestays, hostels',
    features: ['Room board and availability by date', 'Arrivals, in-house and departures', 'Guest bill with charges and payments', 'Housekeeping status and night audit'],
    prompt: `A hotel front-desk system (PMS) for my property. ${TEAM}
Data:
- room types (name like Deluxe/Standard/Suite/Dorm bed, base rate per night, max guests)
- rooms (room number, type, floor, sellable yes/no, housekeeping status: clean/dirty/inspected/out of order, out-of-order reason)
- guests (name, phone, email, nationality, ID type and last 4 digits only, notes, visits count)
- reservations (booking code like BKG-0001, guest name, phone, source: walk-in/phone/website/OTA/agent, OTA reference, room number, check-in date, check-out date, nights (computed), adults, children, rate per night, total, deposit received, status: confirmed/checked in/checked out/cancelled/no-show, special requests, created by email)
- bill charges (booking code, date, item: room night/food/laundry/minibar/extra bed/other, description, amount) — permanent; corrections are a new negative charge with a reason
- payments (booking code, date, amount, method: cash/UPI/card/bank transfer/OTA prepaid, reference) — permanent
- housekeeping log (room number, status change, note, by email, time) — permanent
- logbook (date, shift: morning/evening/night, note, by email) — permanent
Rules: before saving or changing a reservation, check that no other confirmed or checked-in reservation uses the same room on any overlapping night (check-out day is free for a new arrival) and explain any clash; out-of-order rooms can't be booked. Checking in requires the room to be clean or inspected. Checking out adds the room nights as charges if not already added, shows the balance (charges minus payments) and only completes when the balance is zero, then sets the room to dirty.
Screens: a room board for a chosen date range (rooms as rows, dates as columns, reservations as bars coloured by status) with free rooms highlighted; today's arrivals, in-house guests and departures with check-in and check-out buttons; a new reservation form with availability shown for the dates; a reservation page with the guest bill (charges, payments, balance) and buttons to add a charge or record a payment; a housekeeping screen listing rooms by status with one-tap changes; a night audit screen that lists today's confirmed arrivals that never checked in and marks them no-show, and posts tonight's room charge for in-house guests; a summary with occupancy % (occupied rooms ÷ sellable rooms), average daily rate (room revenue ÷ rooms sold), RevPAR (room revenue ÷ sellable rooms), arrivals and departures, and payments received today by method. Never store full ID or passport numbers.
${COMMON}`,
  },
  {
    id: 'memberships', name: 'Memberships', icon: 'dumbbell',
    tagline: 'Members, plans, renewals and check-ins',
    forWho: 'Gyms, studios, clubs, coaching centres, libraries',
    features: ['Members and plans', 'Expiry and renewal reminders list', 'Daily check-ins', 'Active members and revenue'],
    prompt: `A membership management app for my front desk. ${TEAM}
Data: plans (name, duration in days, price, active); members (member number like MEM-0001, name, phone, email, plan, start date, end date, status computed from end date, notes); payments (member number, date, amount, method: cash/UPI/card, plan) — permanent; check-ins (member number, member name, date, time) — permanent.
Screens: a check-in screen to search a member by name, phone or number and tap "Check in", with a clear warning if their membership has expired; members list with filters active / expiring in 7 days / expired; a member page with plan, dates, payment and check-in history, and a "Renew" form that records a payment and extends the end date from the later of today or the current end date; a dashboard with active members, renewals due this week, check-ins today, and collections this month.
${COMMON}`,
  },
  {
    id: 'jobs', name: 'Field jobs', icon: 'wrench',
    tagline: 'Service jobs scheduled, assigned and closed out',
    forWho: 'Plumbers, electricians, AC and appliance repair, cleaning, pest control',
    features: ['Jobs with customer address and time slot', 'Assign technicians', 'Status from scheduled to completed', 'Charges and parts per job'],
    prompt: `A job management app for my field service team. ${TEAM}
Data: customers (name, phone, address, area, notes); jobs (job number like JOB-0001, customer name, phone, address, service type, problem description, scheduled date, time slot: morning/afternoon/evening, technician email, status: new/scheduled/on the way/in progress/completed/cancelled, labour charge, parts charge, total, payment status: unpaid/paid, completion notes); job updates (job number, status, note, by email, time) — permanent.
Screens: a dispatcher board for a chosen date grouped by technician, plus unassigned jobs; "My jobs" for the signed-in technician with big buttons to move to the next status (each change also saves a job update) and a completion form for notes and charges; a new job form with customer search or quick-add; customers list with job history; a summary of jobs completed today, pending jobs and unpaid amount.
${COMMON}`,
  },
];

export const businessKit = (id: string) => BUSINESS_KITS.find((k) => k.id === id);
