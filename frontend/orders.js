const API_BASE_OP = (location.protocol === 'file:') ? 'http://localhost:8080' : location.origin;

let activeOrders = {};
let scheduledOrders = [];
let historyOrders = [];

// ── Alarm state ───────────────────────────────────────────────
const _alertedOrders = new Set();
let opPendingPayment = { orderId: null, total: 0, orderType: null };
let opPendingRefund  = { orderId: null, total: 0 };
let opRefreshTimer = null;

const OP_NEXT = {
  received: { next: 'prepping', label: 'Start Prepping', cls: 'received' },
  prepping:  { next: 'baking',   label: 'Put in Oven',   cls: 'prepping'  },
  baking:    { next: 'ready',    label: 'Mark Ready ✓',  cls: 'baking'    },
  ready:     { next: null,       label: 'Ready',          cls: 'ready'     },
};

// ── Panel open / close ────────────────────────────────────────
function openOrdersPanel() {
  document.getElementById('orders-panel-overlay').style.display = 'flex';
  switchOrdersTab('active');
  loadOrders();
  opRefreshTimer = setInterval(loadOrders, 15000);
}

function closeOrdersPanel() {
  document.getElementById('orders-panel-overlay').style.display = 'none';
  if (opRefreshTimer) { clearInterval(opRefreshTimer); opRefreshTimer = null; }
}

function switchOrdersTab(tab) {
  document.querySelectorAll('.orders-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.getElementById('orders-tab-active').style.display    = tab === 'active'    ? 'block' : 'none';
  document.getElementById('orders-tab-scheduled').style.display = tab === 'scheduled' ? 'block' : 'none';
  document.getElementById('orders-tab-history').style.display   = tab === 'history'   ? 'block' : 'none';
  if (tab === 'history') _loadHistoryOrders();
}

// ── Data loading ──────────────────────────────────────────────
async function loadOrders() {
  await Promise.all([_loadActiveOrders(), _loadScheduledOrders()]);
  _updateOrdersBadge();
}

async function _loadActiveOrders() {
  try {
    const data = await fetch(`${API_BASE_OP}/api/orders/active`).then(r => r.json());
    activeOrders = {};
    data.forEach(o => { activeOrders[o.id] = o; });
    renderActiveBoard();
  } catch (e) { console.error('Failed to load active orders', e); }
}

async function _loadScheduledOrders() {
  try {
    const data = await fetch(`${API_BASE_OP}/api/orders/scheduled`).then(r => r.json());
    scheduledOrders = data;
    renderScheduledBoard();
  } catch (e) { console.error('Failed to load scheduled orders', e); }
}

function _updateOrdersBadge() {
  const total = Object.keys(activeOrders).length + scheduledOrders.length;
  const badge = document.getElementById('orders-badge');
  if (!badge) return;
  if (total > 0) {
    badge.textContent = total;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

// ── Active board ──────────────────────────────────────────────
function renderActiveBoard() {
  const board = document.getElementById('active-orders-board');
  const list  = Object.values(activeOrders).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  if (!list.length) {
    board.innerHTML = '<div class="op-empty">No active orders right now</div>';
    return;
  }
  board.innerHTML = list.map(o => _buildActiveCard(o)).join('');
}

function _buildActiveCard(order) {
  const time      = new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const typeLabel = { carry_out: 'Carry Out', dine_in: 'Dine In', delivery: 'Delivery' }[order.order_type] || order.order_type;

  const itemsHtml = (order.items || []).map(item => {
    const sz  = item.size ? ` (${_cap(item.size)})` : '';
    const qty = item.quantity > 1 ? `${item.quantity}× ` : '';
    return `<div class="op-item-line">${qty}${item.name_snapshot}${sz}</div>`;
  }).join('');

  const customerHtml = (order.order_type === 'delivery' && order.customer_name)
    ? `<div class="op-customer">👤 ${order.customer_name}${order.customer_phone ? ' · ' + order.customer_phone : ''}</div>`
    : '';

  const noteHtml = order.customer_notes
    ? `<div class="op-note">📝 ${order.customer_notes}</div>` : '';

  const needsPayment = order.status === 'ready' &&
    (order.order_type === 'delivery' || order.order_type === 'carry_out');

  let actionBtn;
  if (needsPayment) {
    actionBtn = `<button class="op-btn-collect" onclick="opCollectPayment(${order.id},${order.total},'${order.order_type}')">💰 Collect Payment</button>`;
  } else {
    const info     = OP_NEXT[order.status] || OP_NEXT.ready;
    const disabled = order.status === 'ready' ? 'disabled' : '';
    actionBtn = `<button class="op-btn-advance op-adv-${info.cls}" onclick="opAdvance(${order.id})" ${disabled}>${info.label}</button>`;
  }

  return `
    <div class="op-card" data-status="${order.status}" id="op-card-${order.id}">
      <div class="op-card-header">
        <span class="op-order-num">#${order.id}</span>
        <div class="op-card-meta">
          <span class="op-type-badge op-type-${order.order_type}">${typeLabel}</span>
          ${customerHtml}
          <span class="op-time">${time}</span>
          <span class="op-status-badge op-s-${order.status}">${order.status}</span>
        </div>
      </div>
      <div class="op-items">${itemsHtml}</div>
      ${noteHtml}
      <div class="op-card-footer">
        <span class="op-total">$${(order.total / 100).toFixed(2)}</span>
        ${actionBtn}
      </div>
    </div>`;
}

async function opAdvance(orderId) {
  const order = activeOrders[orderId];
  if (!order) return;
  const info = OP_NEXT[order.status];
  if (!info || !info.next) return;

  const btn = document.querySelector(`#op-card-${orderId} .op-btn-advance`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  try {
    const res = await fetch(`${API_BASE_OP}/api/orders/${orderId}/status?status=${info.next}`, { method: 'PATCH' });
    if (res.ok) {
      activeOrders[orderId].status = info.next;
      renderActiveBoard();
    } else {
      if (btn) { btn.disabled = false; btn.textContent = info.label; }
    }
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = info.label; }
  }
}

// ── Scheduled board ───────────────────────────────────────────
function renderScheduledBoard() {
  const board = document.getElementById('scheduled-orders-board');

  if (!scheduledOrders.length) {
    board.innerHTML = '<div class="op-empty">No scheduled orders</div>';
    return;
  }
  board.innerHTML = scheduledOrders.map(o => _buildScheduledCard(o)).join('');
}

function _buildScheduledCard(order) {
  const sdt      = new Date(order.scheduled_for);
  const now      = new Date();
  const isToday  = sdt.toDateString() === now.toDateString();
  const isTom    = sdt.toDateString() === new Date(now.getTime() + 86400000).toDateString();
  const dayLabel = isToday ? 'Today' : isTom ? 'Tomorrow'
    : sdt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr  = sdt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const typeLabel = { carry_out: 'Carry Out', dine_in: 'Dine In', delivery: 'Delivery' }[order.order_type] || order.order_type;

  const itemsHtml = (order.items || []).map(item => {
    const sz  = item.size ? ` (${_cap(item.size)})` : '';
    const qty = item.quantity > 1 ? `${item.quantity}× ` : '';
    return `<div class="op-item-line">${qty}${item.name_snapshot}${sz}</div>`;
  }).join('');

  const customerHtml = order.customer_name
    ? `<div class="op-customer">👤 ${order.customer_name}${order.customer_phone ? ' · ' + order.customer_phone : ''}</div>`
    : '';

  const noteHtml = order.customer_notes
    ? `<div class="op-note">📝 ${order.customer_notes}</div>` : '';

  const placedTime = new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return `
    <div class="op-card op-sched-card" id="op-scard-${order.id}">
      <div class="op-sched-banner">
        <span class="op-sched-day">${dayLabel}</span>
        <span class="op-sched-clock">🕐 ${timeStr}</span>
      </div>
      <div class="op-card-header">
        <span class="op-order-num">#${order.id}</span>
        <div class="op-card-meta">
          <span class="op-type-badge op-type-${order.order_type}">${typeLabel}</span>
          ${customerHtml}
          <span class="op-placed-label">Placed ${placedTime}</span>
        </div>
      </div>
      <div class="op-items">${itemsHtml}</div>
      ${noteHtml}
      <div class="op-card-footer">
        <span class="op-total">$${(order.total / 100).toFixed(2)}</span>
        <button class="op-btn-start" id="op-start-${order.id}" onclick="startScheduledOrder(${order.id})">▶ Start Now</button>
      </div>
    </div>`;
}

async function startScheduledOrder(orderId) {
  // Capture order data now — it leaves scheduledOrders after start
  const order = scheduledOrders.find(o => o.id === orderId);

  // Pre-mark alarm so it never fires for an already-started order
  _alertedOrders.add(orderId);
  dismissAlarm(orderId);

  const btn = document.getElementById(`op-start-${orderId}`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  try {
    const res = await fetch(`${API_BASE_OP}/api/orders/${orderId}/start`, { method: 'POST' });
    if (res.ok) {
      // Print kitchen ticket (frontend browser print)
      if (order && typeof printKitchenTicket === 'function') {
        const rawItems  = order.items || [];
        const kitchenItems = rawItems.length
          ? rawItems.map(item => ({
              name:         item.name_snapshot || item.name || '(item)',
              size:         item.size         || null,
              quantity:     item.quantity      || 1,
              is_half_half: item.is_half_half  || false,
              left_config:  item.left_config   || null,
              right_config: item.right_config  || null,
              whole_config: item.whole_config  || null,
              notes:        item.notes         || '',
            }))
          : [{ name: 'See order #' + orderId, size: null, quantity: 1, is_half_half: false, left_config: null, right_config: null, whole_config: null, notes: '' }];
        printKitchenTicket(orderId, order.order_type, kitchenItems);
      }
      await loadOrders();
      switchOrdersTab('active');
    } else {
      if (btn) { btn.disabled = false; btn.textContent = '▶ Start Now'; }
    }
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = '▶ Start Now'; }
  }
}

// ── Payment collection ────────────────────────────────────────
function opCollectPayment(orderId, total, orderType) {
  opPendingPayment = { orderId, total, orderType };
  document.getElementById('op-pay-num').textContent    = orderId;
  document.getElementById('op-pay-amount').textContent = `$${(total / 100).toFixed(2)}`;
  document.getElementById('op-pay-title').textContent  =
    orderType === 'carry_out' ? 'Collect Pickup Payment' : 'Collect Delivery Payment';

  document.getElementById('op-pay-btns-delivery').style.display = orderType === 'delivery'  ? 'flex' : 'none';
  document.getElementById('op-pay-btns-carry').style.display    = orderType === 'carry_out' ? 'flex' : 'none';

  document.getElementById('op-pay-overlay').style.display = 'flex';
}

async function opMarkPaid(method) {
  document.getElementById('op-pay-overlay').style.display = 'none';
  const { orderId, total } = opPendingPayment;
  try {
    await fetch(`${API_BASE_OP}/api/payment/cash`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ order_id: orderId, amount: total, method }),
    });
    delete activeOrders[orderId];
    renderActiveBoard();
    _updateOrdersBadge();
  } catch (e) { console.error('Payment record failed', e); }
  opPendingPayment = { orderId: null, total: 0, orderType: null };
}

function opChargeCard() {
  const { orderId, total } = opPendingPayment;
  const cb  = encodeURIComponent(`${API_BASE_OP}/api/payment-done`);
  const url = `square-commerce-v1://payment/create?amount_money=${total}&currency_code=USD&callback_url=${cb}&data_parameter=${orderId}`;
  document.getElementById('op-pay-overlay').style.display = 'none';
  window.location.href = url;
  opPendingPayment = { orderId: null, total: 0, orderType: null };
}

// ── History board ─────────────────────────────────────────────
async function _loadHistoryOrders() {
  const board = document.getElementById('history-orders-board');
  if (board) board.innerHTML = '<div class="op-empty">Loading…</div>';
  try {
    const data = await fetch(`${API_BASE_OP}/api/orders/history`).then(r => r.json());
    historyOrders = data;
    renderHistoryBoard();
  } catch (e) { console.error('Failed to load history', e); }
}

function renderHistoryBoard() {
  const board = document.getElementById('history-orders-board');
  if (!historyOrders.length) {
    board.innerHTML = '<div class="op-empty">No orders in the past 7 days</div>';
    return;
  }
  board.innerHTML = historyOrders.map(o => _buildHistoryCard(o)).join('');
}

function _buildHistoryCard(order) {
  const dt      = new Date(order.created_at);
  const dateStr = dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const typeLabel = { carry_out: 'Carry Out', dine_in: 'Dine In', delivery: 'Delivery' }[order.order_type] || order.order_type;

  const itemsHtml = (order.items || []).map(item => {
    const sz  = item.size ? ` (${_cap(item.size)})` : '';
    const qty = item.quantity > 1 ? `${item.quantity}× ` : '';
    return `<div class="op-item-line">${qty}${item.name_snapshot}${sz}</div>`;
  }).join('');

  const customerHtml = order.customer_name
    ? `<div class="op-customer">👤 ${order.customer_name}${order.customer_phone ? ' · ' + order.customer_phone : ''}</div>`
    : '';

  const noteHtml = order.customer_notes
    ? `<div class="op-note">📝 ${order.customer_notes}</div>` : '';

  const statusBadgeClass = { paid: 'op-s-paid', refunded: 'op-s-refunded', cancelled: 'op-s-cancelled' }[order.status] || 'op-s-paid';
  const statusLabel      = { paid: 'Paid', refunded: 'Refunded', cancelled: 'Cancelled' }[order.status] || order.status;

  const refundBtn = order.status === 'paid'
    ? `<button class="op-btn-refund" onclick="opRefund(${order.id},${order.total})">↩ Refund</button>`
    : '';

  return `
    <div class="op-card" id="op-hcard-${order.id}">
      <div class="op-card-header">
        <span class="op-order-num">#${order.id}</span>
        <div class="op-card-meta">
          <span class="op-type-badge op-type-${order.order_type}">${typeLabel}</span>
          ${customerHtml}
          <span class="op-time">${dateStr} · ${timeStr}</span>
          <span class="op-status-badge ${statusBadgeClass}">${statusLabel}</span>
        </div>
      </div>
      <div class="op-items">${itemsHtml}</div>
      ${noteHtml}
      <div class="op-card-footer">
        <span class="op-total">$${(order.total / 100).toFixed(2)}</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="op-btn-reprint" id="op-reprint-${order.id}" onclick="opReprint(${order.id})">🖨 Reprint</button>
          ${refundBtn}
        </div>
      </div>
    </div>`;
}

function opReprint(orderId) {
  showReceipt(orderId, 'Receipt');
}

function opRefund(orderId, total) {
  opPendingRefund = { orderId, total };
  document.getElementById('op-refund-num').textContent    = orderId;
  document.getElementById('op-refund-amount').textContent = `$${(total / 100).toFixed(2)}`;
  document.getElementById('op-refund-overlay').style.display = 'flex';
}

async function opProcessRefund(method) {
  document.getElementById('op-refund-overlay').style.display = 'none';
  const { orderId } = opPendingRefund;
  try {
    const res = await fetch(`${API_BASE_OP}/api/orders/${orderId}/refund`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ method }),
    });
    if (res.ok) {
      const order = historyOrders.find(o => o.id === orderId);
      if (order) order.status = 'refunded';
      renderHistoryBoard();
      const refundLabel = method === 'cash' ? 'Cash Refund' : 'Card Refund';
      showReceipt(orderId, refundLabel);
    } else {
      alert('Refund failed — please try again.');
    }
  } catch {
    alert('Network error during refund.');
  }
  opPendingRefund = { orderId: null, total: 0 };
}

function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// ── Till Management ───────────────────────────────────────────
let _tillMovements = [];
let _currentTillData = null;

function openTillPanel() {
  document.getElementById('till-panel-overlay').style.display = 'flex';
  _loadTillPanel();
}

function closeTillPanel() {
  document.getElementById('till-panel-overlay').style.display = 'none';
}

async function _loadTillPanel() {
  const body = document.getElementById('till-panel-body');
  if (body) body.innerHTML = '<div class="op-empty">Loading…</div>';
  try {
    const [cashData, tillData] = await Promise.all([
      fetch(`${API_BASE_OP}/api/cash/summary`).then(r => r.json()),
      fetch(`${API_BASE_OP}/api/till/today`).then(r => r.json()).catch(() => null),
    ]);
    renderTillPanel(cashData, tillData);
  } catch (e) {
    const b = document.getElementById('till-panel-body');
    if (b) b.innerHTML = '<div class="op-empty" style="color:#dc2626">Could not load till data — make sure the server is running and Supabase tables exist.</div>';
  }
}

function renderTillPanel(data, tillData) {
  _tillMovements  = data.movements_today || [];
  _currentTillData = tillData;
  const body      = document.getElementById('till-panel-body');
  const isClosed = tillData && tillData.closed;
  const expected = isClosed ? 10000 : (data.expected || 0);
  const fmt      = cents => `$${(cents / 100).toFixed(2)}`;

  // Till session status banner
  let tillBanner = '';
  if (!tillData) {
    tillBanner = `
      <div class="till-status-banner till-warn">
        ⚠️ Could not check till session — ensure Supabase tables exist
      </div>`;
  } else if (tillData.assigned && tillData.closed) {
    const closedAt = new Date(tillData.closed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    tillBanner = `
      <div class="till-status-banner" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0">
        <div style="margin-bottom:10px">🔒 Till closed by <strong>${tillData.closed_by_name || tillData.closed_by}</strong> at ${closedAt}</div>
        <div style="font-size:0.82rem;margin-bottom:10px;opacity:0.85">To continue taking orders, open the till again:</div>
        <input class="cash-input" id="till-panel-emp-id" type="text" placeholder="Employee ID" style="margin-bottom:8px" />
        <div id="till-panel-err" style="color:#fca5a5;font-size:0.8rem;margin-bottom:6px"></div>
        <button class="op-pay-btn" style="width:100%;padding:12px;background:#f97316" onclick="openTillFromPanel()">🪙 Open Till</button>
      </div>`;
  } else if (tillData.assigned) {
    const openedAt = new Date(tillData.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    tillBanner = `
      <div class="till-status-banner till-ok" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <span>✅ Till opened by <strong>${tillData.employee_name}</strong> at ${openedAt}</span>
        <button class="op-btn-reprint" style="padding:6px 14px;font-size:0.82rem;background:#fef3c7;color:#92400e;border:1px solid #d97706" onclick="openReassignTill()">🔄 Reassign Till</button>
      </div>`;
  } else {
    tillBanner = `
      <div class="till-status-banner till-unassigned">
        <div style="font-weight:700;margin-bottom:10px">⚠️ Till not assigned for today</div>
        <div style="font-size:0.82rem;margin-bottom:10px;opacity:0.85">Enter Employee ID to open the till:</div>
        <input class="cash-input" id="till-panel-emp-id" type="text" placeholder="Employee ID" style="margin-bottom:8px" />
        <div id="till-panel-err" style="color:#fca5a5;font-size:0.8rem;margin-bottom:6px"></div>
        <button class="op-pay-btn" style="width:100%;padding:12px;background:#f97316" onclick="openTillFromPanel()">🪙 Open Till</button>
      </div>`;
  }

  // Last count
  let lastCountHtml = '<div class="cash-last-count" style="margin-bottom:16px">No till count recorded yet</div>';
  if (data.last_count) {
    const lc      = data.last_count;
    const diff    = lc.difference;
    const varCls  = Math.abs(diff) <= 100 ? 'cash-variance-ok' : 'cash-variance-bad';
    const varSign = diff >= 0 ? '+' : '';
    const dt      = new Date(lc.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    lastCountHtml = `
      <div class="cash-last-count" style="margin-bottom:16px">
        Last count: <strong>${fmt(lc.amount)}</strong> on ${dt}
        &nbsp;·&nbsp; Variance: <span class="${varCls}">${varSign}${fmt(diff)}</span>
      </div>`;
  }

  // Movements log
  const mvHtml = data.movements_today.length
    ? data.movements_today.map(mv => {
        const mvTime  = new Date(mv.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const labels  = { cash_in: 'In', cash_out: 'Out', count: 'Count' };
        const classes = { cash_in: 'cash-mv-in', cash_out: 'cash-mv-out', count: 'cash-mv-count' };
        const sign    = mv.type === 'cash_out' ? '-' : mv.type === 'count' ? '' : '+';
        const amtTxt  = mv.type === 'count'
          ? `counted ${fmt(mv.amount)}`
          : `${sign}${fmt(mv.amount)}`;
        return `
          <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #f1f5f9">
            <span class="op-status-badge ${classes[mv.type] || ''}">${labels[mv.type] || mv.type}</span>
            <span style="flex:1;font-size:0.875rem;color:#334155">${mv.notes || '—'}</span>
            <span style="font-weight:700;color:#1e293b;font-size:0.875rem">${amtTxt}</span>
            <span class="op-time">${mvTime}</span>
            <button class="op-btn-reprint" onclick="printCashMovement(${mv.id})" style="padding:4px 10px;font-size:0.75rem">🖨</button>
          </div>`;
      }).join('')
    : '<div style="color:#94a3b8;font-size:0.85rem;padding-top:8px">No movements in the last 24 hours</div>';

  body.innerHTML = `
    ${tillBanner}
    <div class="cash-summary-card">
      <div class="cash-expected-label">Expected in drawer</div>
      <div class="cash-expected-amount">${fmt(expected)}</div>
      ${lastCountHtml}
    </div>
    <div class="cash-actions">
      <button class="cash-action-btn in"  onclick="openCashIn()">💵 Cash In</button>
      <button class="cash-action-btn out" onclick="openCashOut()">💸 Cash Out</button>
      <button class="cash-action-btn eod" onclick="openEndOfDay()">🔢 Count Till</button>
    </div>
    <div style="background:#fff;border-radius:12px;padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,0.08)">
      <div style="font-size:0.78rem;font-weight:700;color:#64748b;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.05em">Today's Movements</div>
      ${mvHtml}
    </div>`;
}

function openCashIn() {
  document.getElementById('cashin-amount').value = '';
  document.getElementById('cashin-notes').value  = '';
  document.getElementById('op-cashin-overlay').style.display = 'flex';
}

async function submitCashIn() {
  const dollars = parseFloat(document.getElementById('cashin-amount').value);
  if (!dollars || dollars <= 0) { alert('Enter a valid amount'); return; }
  const notes = document.getElementById('cashin-notes').value.trim();
  try {
    await fetch(`${API_BASE_OP}/api/cash/in`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ amount_cents: Math.round(dollars * 100), notes: notes || null }),
    });
    document.getElementById('op-cashin-overlay').style.display = 'none';
    await _loadTillPanel();
  } catch { alert('Failed to record. Please try again.'); }
}

function openCashOut() {
  document.getElementById('cashout-amount').value = '';
  document.getElementById('cashout-notes').value  = '';
  document.getElementById('op-cashout-overlay').style.display = 'flex';
}

async function submitCashOut() {
  const dollars = parseFloat(document.getElementById('cashout-amount').value);
  if (!dollars || dollars <= 0) { alert('Enter a valid amount'); return; }
  const notes = document.getElementById('cashout-notes').value.trim();
  try {
    await fetch(`${API_BASE_OP}/api/cash/out`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ amount_cents: Math.round(dollars * 100), notes: notes || null }),
    });
    document.getElementById('op-cashout-overlay').style.display = 'none';
    await _loadTillPanel();
  } catch { alert('Failed to record. Please try again.'); }
}

function openCountTill(expectedCents) {
  document.getElementById('op-count-expected').textContent = `$${(expectedCents / 100).toFixed(2)}`;
  document.getElementById('count-amount').value = '';
  document.getElementById('op-count-overlay').style.display = 'flex';
}

async function submitTillCount() {
  const val = document.getElementById('count-amount').value;
  const dollars = parseFloat(val);
  if (val === '' || isNaN(dollars) || dollars < 0) { alert('Enter the amount you counted'); return; }
  try {
    await fetch(`${API_BASE_OP}/api/cash/count`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ amount_cents: Math.round(dollars * 100) }),
    });
    document.getElementById('op-count-overlay').style.display = 'none';
    await _loadTillPanel();
  } catch { alert('Failed to record count. Please try again.'); }
}

// Open till directly from the Till panel (when startup overlay didn't fire)
async function openTillFromPanel() {
  const empId = (document.getElementById('till-panel-emp-id')?.value || '').trim();
  const errEl = document.getElementById('till-panel-err');
  if (!empId) { if (errEl) errEl.textContent = 'Enter your Employee ID'; return; }
  if (errEl) errEl.textContent = '';
  try {
    const res = await fetch(`${API_BASE_OP}/api/till/open`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ employee_id: empId }),
    });
    const d = await res.json();
    if (!res.ok) { if (errEl) errEl.textContent = d.detail || 'Failed to open till'; return; }
    await _loadTillPanel();
  } catch { if (errEl) errEl.textContent = 'Server error — try again'; }
}

// Count Till (End of Day)
function openEndOfDay() {
  document.getElementById('eod-emp-id').value = '';
  document.getElementById('eod-amount').value = '';
  document.getElementById('eod-preview').style.display = 'none';
  document.getElementById('op-eod-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('eod-emp-id').focus(), 50);
}

function updateEodPreview() {
  const val = parseFloat(document.getElementById('eod-amount').value);
  const preview   = document.getElementById('eod-preview');
  const takingsEl = document.getElementById('eod-takings');
  if (isNaN(val) || val < 0) { preview.style.display = 'none'; return; }
  const takings = Math.max(0, Math.round(val * 100) - 10000);
  takingsEl.textContent = `$${(takings / 100).toFixed(2)}`;
  preview.style.display = 'block';
}

async function submitEndOfDay() {
  const empId = document.getElementById('eod-emp-id').value.trim();
  const val   = parseFloat(document.getElementById('eod-amount').value);
  if (!empId)                          { alert('Enter your Employee ID'); return; }
  if (isNaN(val) || val < 0)          { alert('Enter the total cash counted in the register'); return; }
  const amount_cents = Math.round(val * 100);
  if (amount_cents < 10000)           { alert('Amount must be at least $100.00 — that is the float staying in the drawer'); return; }

  try {
    const res = await fetch(`${API_BASE_OP}/api/cash/end-of-day`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ amount_cents, employee_id: empId }),
    });
    const d = await res.json();
    if (!res.ok) { alert(d.detail || 'Failed to record till count'); return; }

    document.getElementById('op-eod-overlay').style.display = 'none';
    await _loadTillPanel();

    // Build and print receipt
    const fmt      = c => `$${(c / 100).toFixed(2)}`;
    const now      = new Date(d.closed_at || Date.now()).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const diff     = d.difference;
    const diffSign = diff >= 0 ? '+' : '';
    const diffClr  = Math.abs(diff) <= 100 ? '#16a34a' : '#dc2626';
    const empLine  = d.employee_name ? `${empId} — ${d.employee_name}` : empId;

    document.getElementById('receipt-content').innerHTML = `
      <div class="r-header">
        <div class="r-name">RUSTIC PIZZA</div>
        <div class="r-meta" style="font-size:1rem;font-weight:700;letter-spacing:0.06em">TILL COUNT</div>
        <div class="r-date">${now}</div>
      </div>
      <hr class="r-divider">
      <div style="text-align:center;font-size:0.82rem;color:#475569;margin-bottom:10px">
        Counted by: <strong>${empLine}</strong>
      </div>
      <hr class="r-divider">
      <div class="r-totals">
        <div class="r-line"><span>Total Counted</span><span>${fmt(amount_cents)}</span></div>
        <div class="r-line"><span>Float in Drawer</span><span>${fmt(d.float_cents)}</span></div>
        <div class="r-line r-total"><span>Takings to Bank</span><span style="color:#c8420a">${fmt(d.takings_cents)}</span></div>
        <div class="r-line" style="margin-top:8px">
          <span style="color:#64748b">System Expected</span>
          <span style="color:#64748b">${fmt(d.expected)}</span>
        </div>
        <div class="r-line">
          <span style="color:#64748b">Variance</span>
          <span style="color:${diffClr};font-weight:700">${diffSign}${fmt(Math.abs(diff))}</span>
        </div>
      </div>
      <hr class="r-divider">
      <div class="r-footer">Till closed for today · Rustic Pizza</div>
    `;
    document.getElementById('receipt-overlay').style.display = 'flex';
  } catch { alert('Failed to record till count. Please try again.'); }
}

// ── Till Reassignment ─────────────────────────────────────────
function openReassignTill() {
  const name = _currentTillData?.employee_name || '—';
  document.getElementById('reassign-current-name').textContent = name;
  document.getElementById('reassign-new-id').value = '';
  document.getElementById('reassign-err').textContent = '';
  document.getElementById('reassign-till-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('reassign-new-id').focus(), 50);
}

async function submitReassignTill() {
  const newId = (document.getElementById('reassign-new-id')?.value || '').trim();
  const errEl = document.getElementById('reassign-err');
  if (!newId) { errEl.textContent = 'Enter the new employee\'s ID'; return; }
  errEl.textContent = '';
  try {
    const res = await fetch(`${API_BASE_OP}/api/till/reassign`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ to_employee_id: newId }),
    });
    const d = await res.json();
    if (!res.ok) { errEl.textContent = d.detail || 'Reassignment failed'; return; }
    document.getElementById('reassign-till-overlay').style.display = 'none';
    await _loadTillPanel();
    const t = document.createElement('div');
    t.className = 'till-toast';
    t.textContent = `Till reassigned to ${d.employee_name}`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  } catch { errEl.textContent = 'Server error — please try again'; }
}

function printCashMovement(id) {
  const mv = _tillMovements.find(m => m.id === id);
  if (!mv) return;

  const typeLabel = { cash_in: 'CASH IN', cash_out: 'CASH OUT', count: 'TILL COUNT' }[mv.type] || mv.type.toUpperCase();
  const time = new Date(mv.created_at).toLocaleString();
  const fmt  = c => '$' + (c / 100).toFixed(2);

  let amountHtml;
  if (mv.type === 'count') {
    const diff    = mv.amount - (mv.expected || 0);
    const diffClr = Math.abs(diff) <= 100 ? '#16a34a' : '#dc2626';
    const diffStr = (diff >= 0 ? '+' : '-') + fmt(Math.abs(diff));
    amountHtml = `
      <div class="r-line"><span>Counted</span><span>${fmt(mv.amount)}</span></div>
      <div class="r-line"><span>Expected</span><span>${fmt(mv.expected || 0)}</span></div>
      <div class="r-line r-total"><span>Variance</span><span style="color:${diffClr}">${diffStr}</span></div>`;
  } else {
    const sign = mv.type === 'cash_out' ? '-' : '+';
    amountHtml = `<div class="r-line r-total"><span>Amount</span><span>${sign}${fmt(mv.amount)}</span></div>`;
  }

  document.getElementById('receipt-content').innerHTML = `
    <div class="r-header">
      <div class="r-name">RUSTIC PIZZA</div>
      <div class="r-meta">${typeLabel}</div>
      <div class="r-date">${time}</div>
    </div>
    <hr class="r-divider">
    <div class="r-totals">
      ${amountHtml}
      ${mv.notes ? `<div class="r-line" style="margin-top:6px"><span>Notes</span><span style="text-align:right;max-width:55%">${mv.notes}</span></div>` : ''}
    </div>
    <div class="r-footer">Rustic Pizza · Till Record</div>
  `;
  document.getElementById('receipt-overlay').style.display = 'flex';
}

// ── 30-minute Order Alarm ─────────────────────────────────────
// Single shared AudioContext — must be unlocked by a user gesture first
let _audioCtx = null;

function _ensureAudioCtx() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { }
  }
  return _audioCtx;
}

// Unlock audio on any user interaction — call this once per click anywhere
function _unlockAudio() {
  const ctx = _ensureAudioCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

function _doBeep(ctx) {
  const beats = [880, 1100, 880, 1100, 880];
  beats.forEach((freq, i) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.value = freq;
    const t = ctx.currentTime + i * 0.22;
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.start(t);
    osc.stop(t + 0.18);
  });
}

function _playAlarmBeep() {
  try {
    const ctx = _ensureAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => _doBeep(ctx)).catch(() => {});
    } else {
      _doBeep(ctx);
    }
  } catch { }
}

function _showAlarmBanner(order, minsLabel) {
  const container = document.getElementById('alarm-container');
  if (!container) return;
  const existing = document.getElementById(`alarm-${order.id}`);
  if (existing) return; // already showing

  const typeLabel = { carry_out: 'Pickup', delivery: 'Delivery', dine_in: 'Dine In' }[order.order_type] || order.order_type;
  const customerPart = order.customer_name ? ` · ${order.customer_name}` : '';

  const banner = document.createElement('div');
  banner.className = 'order-alarm-banner';
  banner.id = `alarm-${order.id}`;
  banner.innerHTML = `
    <span class="alarm-icon">⏰</span>
    <div class="alarm-body">
      <div class="alarm-title">#${order.id} ${typeLabel}${customerPart}</div>
      <div class="alarm-sub">${minsLabel} — start preparing now</div>
    </div>
    <button class="alarm-dismiss" onclick="dismissAlarm(${order.id})" title="Dismiss">✕</button>
  `;
  container.appendChild(banner);
  setTimeout(() => dismissAlarm(order.id), 5 * 60 * 1000);
}

function dismissAlarm(orderId) {
  const el = document.getElementById(`alarm-${orderId}`);
  if (el) el.remove();
}

async function _checkUpcomingOrders() {
  let orders;
  try {
    orders = await fetch(`${API_BASE_OP}/api/orders/scheduled`).then(r => r.json());
    scheduledOrders = orders;
    renderScheduledBoard();
  } catch { return; }

  const now = Date.now();
  orders.forEach(o => {
    if (_alertedOrders.has(o.id)) return;
    const minsUntil = (new Date(o.scheduled_for).getTime() - now) / 60000;
    if (minsUntil <= 30 && minsUntil >= -5) {
      _alertedOrders.add(o.id);
      const minsLabel = minsUntil <= 0
        ? 'Due now!'
        : `Due in ~${Math.round(minsUntil)} min`;
      _playAlarmBeep();
      _showAlarmBanner(o, minsLabel);
    }
  });
}

// Start alarm checker when page loads; unlock audio on first user gesture
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', _unlockAudio, { once: false });
  _checkUpcomingOrders();
  setInterval(_checkUpcomingOrders, 30 * 1000);
});
