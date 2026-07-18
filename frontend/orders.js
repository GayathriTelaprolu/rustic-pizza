const API_BASE_OP = (location.protocol === 'file:') ? 'http://localhost:8080' : location.origin;

let activeOrders = {};
let scheduledOrders = [];
let historyOrders = [];
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
  const btn = document.getElementById('btn-orders-panel');
  if (btn) btn.textContent = total > 0 ? `📋 Orders (${total})` : '📋 Orders';
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
  const btn = document.getElementById(`op-start-${orderId}`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  try {
    const res = await fetch(`${API_BASE_OP}/api/orders/${orderId}/start`, { method: 'POST' });
    if (res.ok) {
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

async function opReprint(orderId) {
  const btn = document.getElementById(`op-reprint-${orderId}`);
  if (btn) { btn.disabled = true; btn.textContent = '🖨 Sending…'; }
  try {
    await fetch(`${API_BASE_OP}/api/orders/${orderId}/reprint`, { method: 'POST' });
    if (btn) { btn.textContent = '✓ Sent'; }
    setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = '🖨 Reprint'; } }, 2000);
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = '🖨 Reprint'; }
  }
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
    const data = await fetch(`${API_BASE_OP}/api/cash/summary`).then(r => r.json());
    renderTillPanel(data);
  } catch (e) { console.error('Failed to load till', e); }
}

function renderTillPanel(data) {
  const body     = document.getElementById('till-panel-body');
  const expected = data.expected || 0;
  const fmt      = cents => `$${(cents / 100).toFixed(2)}`;

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
            <button class="op-btn-reprint" id="cash-print-${mv.id}" onclick="printCashMovement(${mv.id})" style="padding:4px 10px;font-size:0.75rem">🖨</button>
          </div>`;
      }).join('')
    : '<div style="color:#94a3b8;font-size:0.85rem;padding-top:8px">No movements in the last 24 hours</div>';

  body.innerHTML = `
    ${lastCountHtml}
    <div class="cash-actions">
      <button class="cash-action-btn in"    onclick="openCashIn()">💵 Cash In</button>
      <button class="cash-action-btn out"   onclick="openCashOut()">💸 Cash Out</button>
      <button class="cash-action-btn count" onclick="openCountTill(${expected})">🔢 Count Till</button>
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

async function printCashMovement(id) {
  const btn = document.getElementById(`cash-print-${id}`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    await fetch(`${API_BASE_OP}/api/cash/${id}/print`, { method: 'POST' });
    if (btn) { btn.textContent = '✓ Sent'; }
    setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = '🖨'; } }, 2000);
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = '🖨'; }
  }
}
