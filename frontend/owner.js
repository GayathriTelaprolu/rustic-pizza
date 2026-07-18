const API = (location.protocol === 'file:') ? 'http://localhost:8080' : location.origin;

let sessionPin = '';
let allItems   = [];
let currentCat = 'all';
let editingId  = null;

// ── PIN Entry ─────────────────────────────────────────────────

function pinKey(digit) {
  if (sessionPin.length >= 4) return;
  sessionPin += digit;
  updateDots();
  if (sessionPin.length === 4) setTimeout(submitPin, 120);
}

function pinBack() {
  sessionPin = sessionPin.slice(0, -1);
  updateDots();
  clearPinError();
}

function pinClear() {
  sessionPin = '';
  updateDots();
  clearPinError();
}

function updateDots() {
  for (let i = 0; i < 4; i++) {
    document.getElementById(`d${i}`).classList.toggle('filled', i < sessionPin.length);
  }
}

function clearPinError() {
  document.getElementById('pin-error').textContent = '';
}

async function submitPin() {
  try {
    const res = await fetch(`${API}/api/owner/verify`, {
      method: 'POST',
      headers: { 'X-Owner-Pin': sessionPin },
    });
    if (res.ok) {
      document.getElementById('pin-screen').style.display = 'none';
      document.getElementById('owner-screen').style.display = 'flex';
      loadItems();
    } else {
      document.getElementById('pin-error').textContent = 'Incorrect PIN — try again';
      sessionPin = '';
      updateDots();
    }
  } catch {
    document.getElementById('pin-error').textContent = 'Cannot reach server';
    sessionPin = '';
    updateDots();
  }
}

// openOwnerPanel / closeOwnerPanel are used when embedded in index.html
function openOwnerPanel() {
  const overlay = document.getElementById('owner-panel-overlay');
  if (!overlay) return;
  sessionPin = '';
  updateDots();
  clearPinError();
  document.getElementById('pin-screen').style.display   = 'flex';
  document.getElementById('owner-screen').style.display = 'none';
  overlay.style.display = 'block';
}

function closeOwnerPanel() {
  const overlay = document.getElementById('owner-panel-overlay');
  if (overlay) overlay.style.display = 'none';
  sessionPin = '';
  updateDots();
}

function logout() {
  sessionPin = '';
  allItems   = [];
  currentCat = 'all';
  updateDots();
  clearPinError();
  const overlay = document.getElementById('owner-panel-overlay');
  if (overlay) {
    // embedded in POS — close overlay, return to cashier
    overlay.style.display = 'none';
  } else {
    // standalone owner.html — go back to PIN screen
    document.getElementById('owner-screen').style.display = 'none';
    document.getElementById('pin-screen').style.display  = 'flex';
  }
}

// Allow keyboard number entry on PIN screen
document.addEventListener('keydown', e => {
  if (document.getElementById('pin-screen').style.display === 'none') return;
  if (e.key >= '0' && e.key <= '9') pinKey(e.key);
  if (e.key === 'Backspace') pinBack();
  if (e.key === 'Escape') pinClear();
});

// ── Load Items ────────────────────────────────────────────────

async function loadItems() {
  document.getElementById('loading-msg').style.display = 'block';
  document.getElementById('items-table').style.display = 'none';
  try {
    const res = await fetch(`${API}/api/owner/items`, {
      headers: { 'X-Owner-Pin': sessionPin },
    });
    allItems = await res.json();
    renderTable();
  } catch (err) {
    document.getElementById('loading-msg').textContent = 'Failed to load items.';
  }
}

// ── Category tabs ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.cat-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCat = btn.dataset.cat;
      renderTable();
    });
  });
});

// ── Filter & render ───────────────────────────────────────────

function filterItems() {
  renderTable();
}

function renderTable() {
  const query = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
  const rows  = allItems.filter(item => {
    const matchCat  = currentCat === 'all' || item.category === currentCat;
    const matchText = !query || item.name.toLowerCase().includes(query);
    return matchCat && matchText;
  });

  document.getElementById('item-count').textContent = `${rows.length} item${rows.length !== 1 ? 's' : ''}`;
  document.getElementById('loading-msg').style.display = 'none';
  document.getElementById('items-table').style.display = rows.length ? '' : 'none';

  const tbody = document.getElementById('items-tbody');
  tbody.innerHTML = rows.map(item => buildRow(item)).join('');
}

function buildRow(item) {
  const small = item.price_small != null ? `$${(item.price_small / 100).toFixed(2)}` : '—';
  const large = item.price_large != null ? `$${(item.price_large / 100).toFixed(2)}` : '—';
  const catLabel = {
    pizza: 'Pizza', gourmet_pizza: 'Gourmet', calzone: 'Calzone',
    sub_wrap: 'Sub/Wrap', appetizer: 'Appetizer', dinner_plate: 'Dinner Plate',
    salad: 'Salad', dessert: 'Dessert', beverage: 'Beverage',
  }[item.category] || item.category;

  const thumb = item.image_url
    ? `<img src="${escHtml(item.image_url)}" class="thumb" onerror="this.style.display='none'" />`
    : `<div class="thumb-placeholder">🍕</div>`;

  const toggleLabel = item.is_active ? 'Active' : 'Sold Out';
  const toggleClass = item.is_active ? 'toggle-btn active' : 'toggle-btn sold-out';

  return `
    <tr class="${item.is_active ? '' : 'row-inactive'}" id="row-${item.id}">
      <td class="col-photo">${thumb}</td>
      <td class="col-name"><span class="item-name">${escHtml(item.name)}</span></td>
      <td class="col-cat"><span class="cat-badge">${catLabel}</span></td>
      <td class="col-price">${small}</td>
      <td class="col-price">${large}</td>
      <td class="col-status">
        <button class="${toggleClass}" onclick="toggleItem(${item.id}, ${!item.is_active})" id="tog-${item.id}">
          ${toggleLabel}
        </button>
      </td>
      <td class="col-actions">
        <button class="btn-edit" onclick="openEdit(${item.id})">Edit</button>
      </td>
    </tr>`;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Toggle sold-out / active ──────────────────────────────────

async function toggleItem(itemId, newActive) {
  const btn = document.getElementById(`tog-${itemId}`);
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/api/owner/items/${itemId}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Pin': sessionPin },
      body: JSON.stringify({ is_active: newActive }),
    });
    if (!res.ok) throw new Error();
    // Update local data and re-render
    const idx = allItems.findIndex(i => i.id === itemId);
    if (idx !== -1) allItems[idx].is_active = newActive;
    renderTable();
  } catch {
    btn.disabled = false;
    alert('Toggle failed — check server connection.');
  }
}

// ── Edit Modal ────────────────────────────────────────────────

function openEdit(itemId) {
  const item = allItems.find(i => i.id === itemId);
  if (!item) return;

  editingId = itemId;
  document.getElementById('edit-title').textContent = item.name;
  document.getElementById('edit-small').value = item.price_small != null ? (item.price_small / 100).toFixed(2) : '';
  document.getElementById('edit-large').value = item.price_large != null ? (item.price_large / 100).toFixed(2) : '';
  document.getElementById('edit-image').value = item.image_url || '';
  document.getElementById('edit-status').textContent = '';

  updateImagePreview(item.image_url || '');

  document.getElementById('edit-overlay').style.display = 'flex';
}

function closeEdit() {
  document.getElementById('edit-overlay').style.display = 'none';
  editingId = null;
}

// Live image preview as user types URL
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('edit-image').addEventListener('input', function () {
    updateImagePreview(this.value.trim());
  });
});

function updateImagePreview(url) {
  const wrap = document.getElementById('edit-preview-wrap');
  const img  = document.getElementById('edit-preview-img');
  if (url) {
    img.src = url;
    wrap.style.display = 'block';
    img.onerror = () => { wrap.style.display = 'none'; };
    img.onload  = () => { wrap.style.display = 'block'; };
  } else {
    wrap.style.display = 'none';
  }
}

async function saveEdit() {
  if (!editingId) return;
  const btn = document.getElementById('edit-overlay').querySelector('.btn-save');
  const statusEl = document.getElementById('edit-status');
  btn.disabled = true;
  statusEl.textContent = 'Saving...';
  statusEl.className   = 'edit-status';

  const smallVal = document.getElementById('edit-small').value.trim();
  const largeVal = document.getElementById('edit-large').value.trim();
  const imageUrl = document.getElementById('edit-image').value.trim();

  const priceBody = {};
  if (smallVal !== '') priceBody.price_small = Math.round(parseFloat(smallVal) * 100);
  if (largeVal !== '') priceBody.price_large = Math.round(parseFloat(largeVal) * 100);

  try {
    const calls = [];

    if (Object.keys(priceBody).length) {
      calls.push(
        fetch(`${API}/api/owner/items/${editingId}/price`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-Owner-Pin': sessionPin },
          body: JSON.stringify(priceBody),
        })
      );
    }

    // Always save image URL (even if cleared to empty)
    calls.push(
      fetch(`${API}/api/owner/items/${editingId}/image`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Owner-Pin': sessionPin },
        body: JSON.stringify({ image_url: imageUrl || null }),
      })
    );

    const results = await Promise.all(calls);
    if (results.some(r => !r.ok)) throw new Error('Server error');

    // Update local cache
    const idx = allItems.findIndex(i => i.id === editingId);
    if (idx !== -1) {
      if (priceBody.price_small != null) allItems[idx].price_small = priceBody.price_small;
      if (priceBody.price_large != null) allItems[idx].price_large = priceBody.price_large;
      allItems[idx].image_url = imageUrl || null;
    }

    statusEl.textContent = 'Saved!';
    statusEl.className   = 'edit-status success';
    renderTable();
    setTimeout(closeEdit, 700);
  } catch {
    statusEl.textContent = 'Save failed — check connection.';
    statusEl.className   = 'edit-status error';
    btn.disabled = false;
  }
}

// Close edit modal on overlay click
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('edit-overlay').addEventListener('click', function (e) {
    if (e.target === this) closeEdit();
  });
  document.getElementById('new-item-overlay').addEventListener('click', function (e) {
    if (e.target === this) closeNewItem();
  });
  document.getElementById('ni-image').addEventListener('input', function () {
    updateNewItemPreview(this.value.trim());
  });
});

// ── New Item ──────────────────────────────────────────────────

function openNewItem() {
  document.getElementById('ni-name').value        = '';
  document.getElementById('ni-category').value    = '';
  document.getElementById('ni-description').value = '';
  document.getElementById('ni-small').value       = '';
  document.getElementById('ni-large').value       = '';
  document.getElementById('ni-image').value       = '';
  document.getElementById('ni-status').textContent = '';
  document.getElementById('ni-status').className  = 'edit-status';
  document.getElementById('ni-preview-wrap').style.display = 'none';
  document.getElementById('new-item-overlay').style.display = 'flex';
  document.getElementById('ni-name').focus();
}

function closeNewItem() {
  document.getElementById('new-item-overlay').style.display = 'none';
}

function updateNewItemPreview(url) {
  const wrap = document.getElementById('ni-preview-wrap');
  const img  = document.getElementById('ni-preview-img');
  if (url) {
    img.src = url;
    wrap.style.display = 'block';
    img.onerror = () => { wrap.style.display = 'none'; };
    img.onload  = () => { wrap.style.display = 'block'; };
  } else {
    wrap.style.display = 'none';
  }
}

async function saveNewItem() {
  const name     = document.getElementById('ni-name').value.trim();
  const category = document.getElementById('ni-category').value;
  const desc     = document.getElementById('ni-description').value.trim();
  const smallVal = document.getElementById('ni-small').value.trim();
  const largeVal = document.getElementById('ni-large').value.trim();
  const imageUrl = document.getElementById('ni-image').value.trim();
  const statusEl = document.getElementById('ni-status');
  const btn      = document.getElementById('new-item-overlay').querySelector('.btn-save');

  if (!name)     { statusEl.textContent = 'Item name is required.'; statusEl.className = 'edit-status error'; return; }
  if (!category) { statusEl.textContent = 'Category is required.';  statusEl.className = 'edit-status error'; return; }

  const body = {
    name,
    category,
    description:  desc || null,
    price_small:  smallVal ? Math.round(parseFloat(smallVal) * 100) : null,
    price_large:  largeVal ? Math.round(parseFloat(largeVal) * 100) : null,
    image_url:    imageUrl || null,
    is_gourmet_preset: false,
  };

  btn.disabled = true;
  statusEl.textContent = 'Adding...';
  statusEl.className   = 'edit-status';

  try {
    const res = await fetch(`${API}/api/owner/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Pin': sessionPin },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
    const { id } = await res.json();

    // Add to local cache and re-render
    allItems.push({ id, ...body, is_active: true });
    allItems.sort((a, b) => a.name.localeCompare(b.name));
    renderTable();

    statusEl.textContent = 'Item added!';
    statusEl.className   = 'edit-status success';
    setTimeout(closeNewItem, 700);
  } catch {
    statusEl.textContent = 'Failed to add item — check connection.';
    statusEl.className   = 'edit-status error';
    btn.disabled = false;
  }
}
