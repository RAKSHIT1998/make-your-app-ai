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
  icon: 'contact' | 'shopping-cart' | 'boxes' | 'calendar-clock' | 'receipt' | 'life-buoy' | 'plane' | 'utensils' | 'dumbbell' | 'wrench';
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
    tagline: 'Leads, customers, deals and follow-ups in one place',
    forWho: 'Agencies, consultants, real estate, B2B sales teams',
    features: ['Contacts and companies', 'Deal pipeline with stages and values', 'Notes and follow-up reminders', 'Pipeline totals and won/lost this month'],
    prompt: `A CRM for my sales team. ${TEAM}
Data: contacts (name, company, email, phone, source: website/referral/walk-in/social/other, status: lead/customer/inactive, notes); deals (title, contact name, value, stage: new/contacted/proposal/negotiation/won/lost, expected close date, owner email); activities (deal or contact, type: call/email/meeting/note, date, summary, follow-up date, done yes/no). Activities are permanent history (cannot be edited or deleted); contacts and deals can be edited by any team member.
Screens: a dashboard with open pipeline value per stage, deals won and lost this month, and follow-ups due today or overdue; a pipeline board grouped by stage with a quick "move to next stage" button; contacts list with search and status filter; a contact page showing their deals and activity timeline with a form to log an activity.
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
    tagline: 'Table orders straight to the kitchen screen',
    forWho: 'Restaurants, cafés, cloud kitchens, food trucks',
    features: ['Menu with categories and availability', 'Orders per table or takeaway', 'Kitchen screen: new, preparing, ready', 'Daily sales and best sellers'],
    prompt: `A restaurant ordering app for waiters, the kitchen and the cashier. ${TEAM}
Data: menu items (name, category: starters/mains/breads/drinks/desserts/other, price, veg yes/no, available yes/no); orders (order number like ORD-0001, table number or "Takeaway", items as text lines "qty x item (notes)", subtotal, tax, total, status: placed/preparing/ready/served/paid/cancelled, payment method, waiter email, time placed).
Screens: a waiter screen to pick a table, tap menu items by category (unavailable items greyed out), add notes like "less spicy", and place the order; a kitchen screen showing placed and preparing orders as large cards, oldest first, with one-tap "Start" and "Ready", refreshing automatically every 15 seconds; a cashier screen listing ready/served orders to mark paid with a payment method; a menu screen to edit items and toggle availability; today's sales, order count and top 5 items.
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
