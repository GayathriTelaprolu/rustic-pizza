const API_BASE = (location.protocol === 'file:') ? 'http://localhost:8080' : location.origin;
const TAX_RATE   = 0.0625;
const TEST_MODE  = true;   // set false when Square reader is connected

const CAT_LABELS = {
  pizza:        'Pizza',
  gourmet_pizza:'Gourmet Pizza',
  calzone:      'Calzones',
  sub_wrap:     'Subs & Wraps',
  appetizer:    'Appetizers',
  dinner_plate: 'Dinner Plates',
  salad:        'Salads',
  dessert:      'Desserts',
  beverage:     'Beverages',
  slice:        'By the Slice',
  custom:       'Custom Item',
};

// ── App State ────────────────────────────────────────────────
let menu       = {};   // { category: [item, ...] }
let modifiers  = {};   // { topping: [], sauce: [], ... }
let cart       = [];
let orderType  = 'carry_out';
let currentItem = null;
let currentOrderId   = null;
let currentOrderTotal = 0;
let deliveryInfo = { name: '', phone: '', notes: '' };

// Pizza builder state — mutated in place by picker functions
let pizzaState = {};

// ── Init ─────────────────────────────────────────────────────
async function init() {
  try {
    const [menuData, modData] = await Promise.all([
      fetch(`${API_BASE}/api/menu`).then(r => r.json()),
      fetch(`${API_BASE}/api/menu/modifiers`).then(r => r.json()),
    ]);
    menu      = menuData;
    modifiers = modData;
  } catch (e) {
    document.getElementById('items-grid').innerHTML =
      `<p class="loading-msg" style="color:#c00">Cannot reach server at ${API_BASE}<br>Make sure uvicorn is running.</p>`;
    return;
  }

  // Category buttons — live in the menu picker overlay
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showCategory(btn.dataset.cat);
      closeMenuPicker();
      // Update sidebar indicator
      const el = document.getElementById('sidebar-cat-name');
      if (el) el.textContent = CAT_LABELS[btn.dataset.cat] || btn.dataset.cat;
    });
  });

  // Order type tabs
  document.querySelectorAll('.type-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      orderType = tab.dataset.type;
      document.getElementById('carryout-info').style.display  = orderType === 'carry_out' ? 'block' : 'none';
      document.getElementById('delivery-info').style.display  = orderType === 'delivery'  ? 'block' : 'none';
    });
  });

  // Close modal on backdrop click
  document.getElementById('overlay').addEventListener('click', e => {
    if (e.target.id === 'overlay') closeModal();
  });

  // Card number: auto-format as #### #### #### ####
  document.getElementById('cp-number').addEventListener('input', function () {
    const digits = this.value.replace(/\D/g, '').slice(0, 16);
    this.value = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  });
  // Expiry: auto-format as MM/YY
  document.getElementById('cp-expiry').addEventListener('input', function () {
    const digits = this.value.replace(/\D/g, '').slice(0, 4);
    this.value = digits.length > 2 ? digits.slice(0, 2) + '/' + digits.slice(2) : digits;
  });

  // Default category — slice is now first
  document.querySelector('.cat-btn[data-cat="slice"]').classList.add('active');
  showCategory('slice');

  // Check till assignment
  checkTillSession();
}

// ── Category / Items ─────────────────────────────────────────
function showCategory(cat) {
  if (cat === 'custom') { openCustomItem(); return; }

  document.getElementById('panel-title').textContent = CAT_LABELS[cat] || cat;
  const items = menu[cat] || [];
  const grid  = document.getElementById('items-grid');

  if (!items.length) {
    grid.innerHTML = '<p class="loading-msg">No items in this category.</p>';
    return;
  }

  grid.innerHTML = items.map(item => `
    <div class="item-card" onclick="openItem(${item.id})">
      <div class="item-name">${item.name}</div>
      <div class="item-price">${priceLabel(item)}</div>
    </div>
  `).join('');
}

function priceLabel(item) {
  if (item.price_small && item.price_large)
    return `<span class="price-from">from </span>$${(item.price_small / 100).toFixed(2)}`;
  if (item.price_small) return `$${(item.price_small / 100).toFixed(2)}`;
  if (item.price_large) return `$${(item.price_large / 100).toFixed(2)}`;
  return '';
}

// ── Open item → route to correct modal ──────────────────────
function openItem(itemId) {
  let found = null;
  for (const items of Object.values(menu)) {
    found = items.find(i => i.id === itemId);
    if (found) break;
  }
  if (!found) return;
  currentItem = found;

  const c = found.category;
  if      (c === 'pizza' || c === 'gourmet_pizza') openPizzaModal(found);
  else if (c === 'calzone')      openCalzoneModal(found);
  else if (c === 'sub_wrap')     openSubModal(found);
  else if (c === 'salad')        openSaladModal(found);
  else if (c === 'dinner_plate') openDinnerModal(found);
  else                           openSimpleModal(found);
}

// ── Modal helpers ────────────────────────────────────────────
function showModal() { document.getElementById('overlay').classList.add('open'); }

function closeModal() {
  document.getElementById('overlay').classList.remove('open');
  currentItem = null;
}

function setModalBody(html) { document.getElementById('modal-body').innerHTML = html; }

// ── Simple Modal (appetizer / dessert / beverage) ────────────
function openSimpleModal(item) {
  const hasBoth = item.price_small && item.price_large;
  setModalBody(`
    <div class="modal-title">${item.name}</div>
    <div class="modal-subtitle">${item.description || ''}</div>
    ${hasBoth ? sizeHtml(item) : ''}
    <textarea class="notes-input" id="item-notes" placeholder="Special instructions (optional)"></textarea>
    <div class="modal-footer">
      <button class="btn-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-add" onclick="addSimpleToCart()">Add to Order</button>
    </div>
  `);
  showModal();
}

function addSimpleToCart() {
  const item  = currentItem;
  const sizeEl = document.querySelector('.size-btn.selected');
  const size   = sizeEl?.dataset.size || null;
  const notes  = document.getElementById('item-notes')?.value || '';
  const price  = size === 'small' ? item.price_small
               : size === 'large' ? item.price_large
               : (item.price_large || item.price_small);
  pushToCart({ menu_item_id: item.id, name: item.name, size, price, quantity: 1, notes, detail: size ? cap(size) : '' });
  closeModal();
}

// ── Sub / Wrap Modal ─────────────────────────────────────────
function openSubModal(item) {
  const hasBoth   = item.price_small && item.price_large;
  const veggies   = modifiers.veggie  || [];
  const cheeses   = modifiers.cheese  || [];

  setModalBody(`
    <div class="modal-title">${item.name}</div>
    <div class="modal-subtitle">${item.description || ''}</div>
    ${hasBoth ? sizeHtml(item) : ''}
    ${veggies.length ? `
      <div class="section-label">Veggies</div>
      <div class="toppings-grid">${veggies.map(v =>
        `<div class="topping-chip" data-id="${v.id}" onclick="this.classList.toggle('selected')">${v.name}</div>`
      ).join('')}</div>` : ''}
    ${cheeses.length ? `
      <div class="section-label">Cheese</div>
      <div class="pill-group" id="cheese-grp">${cheeses.map((c,i) =>
        `<div class="pill-btn${i===0?' selected':''}" onclick="selectPill(this,'cheese-grp')">${c.name}</div>`
      ).join('')}</div>` : ''}
    <textarea class="notes-input" id="item-notes" placeholder="Special instructions (optional)"></textarea>
    <div class="modal-footer">
      <button class="btn-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-add" onclick="addSubToCart()">Add to Order</button>
    </div>
  `);
  showModal();
}

function addSubToCart() {
  const item    = currentItem;
  const sizeEl  = document.querySelector('.size-btn.selected');
  const size    = sizeEl?.dataset.size || null;
  const notes   = document.getElementById('item-notes')?.value || '';
  const veggies = [...document.querySelectorAll('.toppings-grid .topping-chip.selected')].map(e => e.textContent).join(', ');
  const cheese  = document.querySelector('#cheese-grp .pill-btn.selected')?.textContent || '';
  const price   = size === 'small' ? item.price_small : item.price_large || item.price_small;
  const detail  = [size ? cap(size) : '', veggies, cheese].filter(Boolean).join(' · ');
  pushToCart({ menu_item_id: item.id, name: item.name, size, price, quantity: 1, notes, detail });
  closeModal();
}

// ── Salad Modal ──────────────────────────────────────────────
function openSaladModal(item) {
  const dressings = modifiers.dressing || [];
  const meats     = modifiers.meat     || [];

  setModalBody(`
    <div class="modal-title">${item.name}</div>
    <div class="modal-subtitle">${item.description || ''}</div>
    ${dressings.length ? `
      <div class="section-label">Dressing</div>
      <div class="pill-group" id="dressing-grp">${dressings.map((d,i) =>
        `<div class="pill-btn${i===0?' selected':''}" onclick="selectPill(this,'dressing-grp')">${d.name}</div>`
      ).join('')}</div>` : ''}
    ${meats.length ? `
      <div class="section-label">Add Meat (optional)</div>
      <div class="pill-group" id="meat-grp">
        <div class="pill-btn selected" onclick="selectPill(this,'meat-grp')">None</div>
        ${meats.map(m => `<div class="pill-btn" onclick="selectPill(this,'meat-grp')">${m.name}</div>`).join('')}
      </div>` : ''}
    <textarea class="notes-input" id="item-notes" placeholder="Special instructions (optional)"></textarea>
    <div class="modal-footer">
      <button class="btn-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-add" onclick="addSaladToCart()">Add to Order</button>
    </div>
  `);
  showModal();
}

function addSaladToCart() {
  const item     = currentItem;
  const notes    = document.getElementById('item-notes')?.value || '';
  const dressing = document.querySelector('#dressing-grp .pill-btn.selected')?.textContent || '';
  const meat     = document.querySelector('#meat-grp .pill-btn.selected')?.textContent || '';
  const price    = item.price_large || item.price_small;
  const detail   = [dressing, meat !== 'None' ? `+${meat}` : ''].filter(Boolean).join(' · ');
  pushToCart({ menu_item_id: item.id, name: item.name, size: null, price, quantity: 1, notes, detail });
  closeModal();
}

// ── Dinner Plate Modal ───────────────────────────────────────
function openDinnerModal(item) {
  const meats = modifiers.meat || [];

  setModalBody(`
    <div class="modal-title">${item.name}</div>
    <div class="modal-subtitle">${item.description || ''}</div>
    ${meats.length ? `
      <div class="section-label">Meat Choice</div>
      <div class="pill-group" id="meat-grp">${meats.map((m,i) =>
        `<div class="pill-btn${i===0?' selected':''}" onclick="selectPill(this,'meat-grp')">${m.name}</div>`
      ).join('')}</div>` : ''}
    <textarea class="notes-input" id="item-notes" placeholder="Special instructions (optional)"></textarea>
    <div class="modal-footer">
      <button class="btn-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-add" onclick="addDinnerToCart()">Add to Order</button>
    </div>
  `);
  showModal();
}

function addDinnerToCart() {
  const item  = currentItem;
  const notes = document.getElementById('item-notes')?.value || '';
  const meat  = document.querySelector('#meat-grp .pill-btn.selected')?.textContent || '';
  const price = item.price_large || item.price_small;
  pushToCart({ menu_item_id: item.id, name: item.name, size: null, price, quantity: 1, notes, detail: meat });
  closeModal();
}

// ── Calzone Modal ────────────────────────────────────────────
function openCalzoneModal(item) {
  const hasBoth  = item.price_small && item.price_large;
  const fillings = modifiers.filling || [];

  setModalBody(`
    <div class="modal-title">${item.name}</div>
    <div class="modal-subtitle">${item.description || ''}</div>
    ${hasBoth ? sizeHtml(item) : ''}
    ${fillings.length ? `
      <div class="section-label">Fillings</div>
      <div class="toppings-grid">${fillings.map(f => {
        const pre = (f.name === 'Ricotta' || f.name === 'Mozzarella') ? ' selected' : '';
        return `<div class="topping-chip${pre}" onclick="this.classList.toggle('selected')">${f.name}${f.extra_price > 0 ? ` +$${(f.extra_price/100).toFixed(2)}` : ''}</div>`;
      }).join('')}</div>` : ''}
    <textarea class="notes-input" id="item-notes" placeholder="Special instructions (optional)"></textarea>
    <div class="modal-footer">
      <button class="btn-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-add" onclick="addCalzoneToCart()">Add to Order</button>
    </div>
  `);
  showModal();
}

function addCalzoneToCart() {
  const item     = currentItem;
  const sizeEl   = document.querySelector('.size-btn.selected');
  const size     = sizeEl?.dataset.size || null;
  const notes    = document.getElementById('item-notes')?.value || '';
  const fillings = [...document.querySelectorAll('.toppings-grid .topping-chip.selected')].map(e => e.textContent).join(', ');
  const price    = size === 'small' ? item.price_small : item.price_large || item.price_small;
  const detail   = [size ? cap(size) : '', fillings].filter(Boolean).join(' · ');
  pushToCart({ menu_item_id: item.id, name: item.name, size, price, quantity: 1, notes, detail });
  closeModal();
}

// ── Pizza Modal ───────────────────────────────────────────────
function openPizzaModal(item) {
  // Default state
  pizzaState = {
    size: item.price_large ? 'large' : 'small',
    isHalfHalf: false,
    whole: freshHalf(item),
    left:  freshHalf(item, 'custom'),
    right: freshHalf(item, 'custom'),
  };
  renderPizzaModal();
  showModal();
}

function freshHalf(item, forceType) {
  const type = forceType || (item.category === 'gourmet_pizza' ? 'preset' : 'custom');
  return { type, preset_id: (item.is_gourmet_preset && type === 'preset') ? item.id : null, toppings: [], sauce: 'Marinara' };
}

function renderPizzaModal() {
  const item      = currentItem;
  const hasBoth   = item.price_small && item.price_large;
  const toppings  = modifiers.topping || [];
  const sauces    = (modifiers.sauce   || []).map(s => s.name);
  const presets   = (menu.gourmet_pizza || []).filter(p => p.is_gourmet_preset);

  let html = `
    <div class="modal-title">${item.name}</div>
    <div class="modal-subtitle">${item.category === 'pizza' ? 'Pizza Your Way' : 'Gourmet Pizza'}</div>
    ${hasBoth ? sizeHtml(item, pizzaState.size, 'setPizzaSize') : ''}
    <div class="section-label">Pizza Type</div>
    <div class="toggle-group">
      <button class="toggle-btn${!pizzaState.isHalfHalf ? ' selected' : ''}" onclick="setPizzaHalf(false)">Whole</button>
      <button class="toggle-btn${pizzaState.isHalfHalf  ? ' selected' : ''}" onclick="setPizzaHalf(true)">Half &amp; Half</button>
    </div>
  `;

  if (!pizzaState.isHalfHalf) {
    html += halfBuilder('whole', pizzaState.whole, item, toppings, sauces, presets);
  } else {
    html += `<div class="half-half-grid">
      <div class="half-panel">
        <div class="half-label left">LEFT HALF</div>
        ${halfBuilder('left', pizzaState.left, item, toppings, sauces, presets)}
      </div>
      <div class="half-panel">
        <div class="half-label right">RIGHT HALF</div>
        ${halfBuilder('right', pizzaState.right, item, toppings, sauces, presets)}
      </div>
    </div>`;
  }

  html += `
    <textarea class="notes-input" id="item-notes" placeholder="Special instructions (optional)"></textarea>
    <div class="modal-footer">
      <button class="btn-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-add" onclick="addPizzaToCart()">Add to Order</button>
    </div>
  `;

  setModalBody(html);
}

function halfBuilder(side, state, item, toppings, sauces, presets) {
  const showTabs = pizzaState.isHalfHalf || item.category === 'gourmet_pizza';
  let html = '';

  if (showTabs) {
    html += `<div class="half-type-tabs">
      <button class="half-type-tab${state.type === 'custom' ? ' active' : ''}" onclick="setHalfType('${side}','custom')">Custom</button>
      <button class="half-type-tab${state.type === 'preset' ? ' active' : ''}" onclick="setHalfType('${side}','preset')">Gourmet Preset</button>
    </div>`;
  }

  if (state.type === 'preset') {
    html += `<div class="section-label">Choose Preset</div>
    <div class="preset-list" id="preset-${side}">
      ${presets.map(p => `
        <div class="preset-item${state.preset_id === p.id ? ' selected' : ''}" onclick="selectPreset('${side}',${p.id},this)">
          <div>${p.name}</div>
          ${p.description ? `<div class="preset-desc">${p.description}</div>` : ''}
        </div>`).join('')}
    </div>`;
  } else {
    html += `<div class="section-label">Toppings</div>
    <div class="toppings-grid" id="toppings-${side}">
      ${toppings.map(t => `
        <div class="topping-chip${state.toppings.includes(t.id) ? ' selected' : ''}"
             onclick="toggleTopping('${side}',${t.id},this)">${t.name}</div>`).join('')}
    </div>
    <div class="section-label">Sauce</div>
    <div class="pill-group" id="sauce-${side}">
      ${sauces.map(s => `
        <div class="pill-btn${state.sauce === s ? ' selected' : ''}"
             onclick="selectSauce('${side}','${s}',this)">${s}</div>`).join('')}
    </div>`;
  }
  return html;
}

// Pizza state mutators
function setPizzaSize(size, el) {
  pizzaState.size = size;
  document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
}

function setPizzaHalf(isHalf) {
  pizzaState.isHalfHalf = isHalf;
  renderPizzaModal();
}

function setHalfType(side, type) {
  pizzaState[side].type = type;
  if (type === 'custom') pizzaState[side].preset_id = null;
  renderPizzaModal();
}

function selectPreset(side, id, el) {
  pizzaState[side].preset_id = id;
  document.querySelectorAll(`#preset-${side} .preset-item`).forEach(p => p.classList.remove('selected'));
  el.classList.add('selected');
}

function toggleTopping(side, id, el) {
  const arr = pizzaState[side].toppings;
  const idx = arr.indexOf(id);
  idx === -1 ? arr.push(id) : arr.splice(idx, 1);
  el.classList.toggle('selected');
}

function selectSauce(side, sauce, el) {
  pizzaState[side].sauce = sauce;
  document.querySelectorAll(`#sauce-${side} .pill-btn`).forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
}

function addPizzaToCart() {
  const item   = currentItem;
  const size   = pizzaState.size;
  const notes  = document.getElementById('item-notes')?.value || '';
  const price  = size === 'small' ? item.price_small : item.price_large;

  let detail = cap(size);
  let left_config = null, right_config = null, whole_config = null;

  if (pizzaState.isHalfHalf) {
    detail += ' · Half & Half';
    const leftPreset  = getPresetName(pizzaState.left.preset_id);
    const rightPreset = getPresetName(pizzaState.right.preset_id);
    detail += ` | L:${leftPreset || 'Custom'} R:${rightPreset || 'Custom'}`;
    left_config  = { preset_id: pizzaState.left.preset_id,  toppings: pizzaState.left.toppings,  sauce: pizzaState.left.sauce  };
    right_config = { preset_id: pizzaState.right.preset_id, toppings: pizzaState.right.toppings, sauce: pizzaState.right.sauce };
  } else {
    const preset = getPresetName(pizzaState.whole.preset_id);
    if (preset) detail += ` · ${preset}`;
    whole_config = { preset_id: pizzaState.whole.preset_id, toppings: pizzaState.whole.toppings, sauce: pizzaState.whole.sauce };
  }

  pushToCart({
    menu_item_id: item.id,
    name: item.name,
    size, price, quantity: 1, notes, detail,
    is_half_half: pizzaState.isHalfHalf,
    left_config, right_config, whole_config,
  });
  closeModal();
}

function getPresetName(id) {
  if (!id) return null;
  const p = (menu.gourmet_pizza || []).find(x => x.id === id);
  return p ? p.name : null;
}

// ── Shared UI helpers ────────────────────────────────────────
function sizeHtml(item, selectedSize, onclickFn) {
  const sel  = selectedSize || 'large';
  const fn   = onclickFn   || 'selectSize';
  return `
    <div class="section-label">Size</div>
    <div class="size-group">
      ${item.price_small ? `
        <div class="size-btn${sel==='small'?' selected':''}" data-size="small" onclick="${fn}('small',this)">
          <span class="size-label">Small</span>
          <span class="size-price">$${(item.price_small/100).toFixed(2)}</span>
        </div>` : ''}
      ${item.price_large ? `
        <div class="size-btn${sel==='large'?' selected':''}" data-size="large" onclick="${fn}('large',this)">
          <span class="size-label">Large</span>
          <span class="size-price">$${(item.price_large/100).toFixed(2)}</span>
        </div>` : ''}
    </div>`;
}

function selectSize(size, el) {
  document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
}

function selectPill(el, groupId) {
  document.querySelectorAll(`#${groupId} .pill-btn`).forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
}

function cap(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''; }

// ── Cart ─────────────────────────────────────────────────────
function pushToCart(item) {
  cart.push(item);
  renderCart();
}

function removeFromCart(idx) {
  cart.splice(idx, 1);
  renderCart();
}

function changeQty(idx, delta) {
  cart[idx].quantity += delta;
  if (cart[idx].quantity <= 0) removeFromCart(idx);
  else renderCart();
}

function clearCart() {
  cart = [];
  renderCart();
}

function renderCart() {
  const el = document.getElementById('cart-items');

  if (!cart.length) {
    el.innerHTML = '<div class="cart-empty">No items added yet</div>';
    updateTotals(0, 0, 0);
    return;
  }

  let subtotal = 0;
  el.innerHTML = cart.map((item, i) => {
    const lineTotal = item.price * item.quantity;
    subtotal += lineTotal;
    return `
      <div class="cart-item">
        <div class="cart-item-header">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-price">$${(lineTotal/100).toFixed(2)}</div>
        </div>
        ${item.detail ? `<div class="cart-item-detail">${item.detail}</div>` : ''}
        ${item.notes  ? `<div class="cart-item-detail">📝 ${item.notes}</div>` : ''}
        <div class="cart-item-actions">
          <button class="qty-btn" onclick="changeQty(${i},-1)">−</button>
          <span class="qty-display">${item.quantity}</span>
          <button class="qty-btn" onclick="changeQty(${i},1)">+</button>
          <button class="btn-remove" onclick="removeFromCart(${i})">Remove</button>
        </div>
      </div>`;
  }).join('');

  const tax   = Math.round(subtotal * TAX_RATE);
  const total = subtotal + tax;
  updateTotals(subtotal, tax, total);
}

function updateTotals(sub, tax, total) {
  document.getElementById('display-subtotal').textContent = `$${(sub/100).toFixed(2)}`;
  document.getElementById('display-tax').textContent      = `$${(tax/100).toFixed(2)}`;
  document.getElementById('display-total').textContent    = `$${(total/100).toFixed(2)}`;
}

// ── Order ─────────────────────────────────────────────────────
async function placeOrder() {
  if (!cart.length) return;

  const btn    = document.getElementById('btn-order');
  btn.disabled = true;
  btn.textContent = 'Placing…';

  // Validate & capture customer info
  if (orderType === 'delivery') {
    const name  = document.getElementById('del-name')?.value.trim() || '';
    const phone = document.getElementById('del-phone')?.value.trim() || '';
    if (!name || !phone) {
      alert('Please enter the customer name and phone number for delivery orders.');
      btn.disabled = false;
      btn.textContent = 'Place Order';
      return;
    }
    deliveryInfo = { name, phone, notes: document.getElementById('del-notes')?.value.trim() || '' };
  } else if (orderType === 'carry_out') {
    deliveryInfo = {
      name:  document.getElementById('co-name')?.value.trim()  || '',
      phone: document.getElementById('co-phone')?.value.trim() || '',
      notes: '',
    };
  } else {
    deliveryInfo = { name: '', phone: '', notes: '' };
  }

  const schedDt = document.getElementById('schedule-dt')?.value;

  const payload = {
    order_type: orderType,
    customer_name:  deliveryInfo.name  || null,
    customer_phone: deliveryInfo.phone || null,
    customer_notes: deliveryInfo.notes || null,
    scheduled_for:  schedDt ? new Date(schedDt).toISOString() : null,
    items: cart.map(item => ({
      menu_item_id:       item.menu_item_id || null,
      custom_name:        item.menu_item_id ? null : item.name,
      custom_price_cents: item.menu_item_id ? null : item.price,
      size:               item.size   || null,
      quantity:           item.quantity,
      is_half_half:       item.is_half_half  || false,
      left_config:        item.left_config   || null,
      right_config:       item.right_config  || null,
      whole_config:       item.whole_config  || null,
      notes:              item.notes || null,
    })),
  };

  try {
    const res = await fetch(`${API_BASE}/api/orders`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || 'Order failed — please try again.');
      btn.disabled    = false;
      btn.textContent = 'Place Order';
      return;
    }

    const data        = await res.json();
    currentOrderId    = data.order_id;
    currentOrderTotal = data.total;

    const isDelivery = orderType === 'delivery';
    document.getElementById('conf-order-id').textContent = data.order_id;
    document.getElementById('conf-total').textContent    = `$${(data.total/100).toFixed(2)}`;
    document.getElementById('confirm-overlay').style.display = 'flex';

    // Show correct payment section for each order type
    document.getElementById('payment-std').style.display   = orderType === 'dine_in'   ? 'flex'  : 'none';
    document.getElementById('payment-carry').style.display = orderType === 'carry_out' ? 'block' : 'none';
    document.getElementById('payment-del').style.display   = isDelivery               ? 'block' : 'none';

    // Delivery customer recap
    const confDel = document.getElementById('conf-delivery-info');
    if (isDelivery && deliveryInfo.name) {
      confDel.style.display = 'block';
      confDel.innerHTML =
        `<div>👤 <strong>${deliveryInfo.name}</strong></div>` +
        (deliveryInfo.phone ? `<div>📞 ${deliveryInfo.phone}</div>` : '') +
        (deliveryInfo.notes ? `<div>📍 ${deliveryInfo.notes}</div>` : '');
    } else {
      confDel.style.display = 'none';
    }

    // Test simulate button for dine-in and carry-out Square card payments
    document.getElementById('test-payment-row').style.display =
      (TEST_MODE && !isDelivery) ? 'block' : 'none';

    const ticketItems = [...cart];
    const ticketType  = orderType;
    cart = [];
    renderCart();
    clearSchedule();
    if (!payload.scheduled_for) printKitchenTicket(data.order_id, ticketType, ticketItems);
    btn.disabled    = false;
    btn.textContent = 'Place Order';
    // Refresh badge count on orders panel button
    if (typeof loadOrders === 'function') loadOrders();
  } catch (e) {
    alert('Network error. Is the server running?');
    btn.disabled    = false;
    btn.textContent = 'Place Order';
  }
}

// ── Payment ───────────────────────────────────────────────────
function chargeCard() {
  const cents       = currentOrderTotal;
  const callbackUrl = encodeURIComponent(`${API_BASE}/api/payment-done`);
  const url = `square-commerce-v1://payment/create?amount_money=${cents}&currency_code=USD&callback_url=${callbackUrl}&data_parameter=${currentOrderId}`;
  window.location.href = url;
  closeConfirm();
}

async function recordCash() {
  const orderId = currentOrderId;
  try {
    await fetch(`${API_BASE}/api/payment/cash`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ order_id: orderId, amount: currentOrderTotal, method: 'cash' }),
    });
  } catch { /* non-critical */ }
  closeConfirm();
  showReceipt(orderId, 'Cash');
}

function recordCardPhone() {
  // Show the card entry form — don't record payment yet
  document.getElementById('cp-order-id').textContent = currentOrderId;
  document.getElementById('cp-total').textContent    = `$${(currentOrderTotal / 100).toFixed(2)}`;
  document.getElementById('card-phone-overlay').style.display = 'flex';
}

function closeCardPhone() {
  document.getElementById('card-phone-overlay').style.display = 'none';
  ['cp-name', 'cp-number', 'cp-expiry', 'cp-cvv'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

async function processCardPhone() {
  const name   = document.getElementById('cp-name').value.trim();
  const number = document.getElementById('cp-number').value.replace(/\s/g, '');
  const expiry = document.getElementById('cp-expiry').value.trim();
  const cvv    = document.getElementById('cp-cvv').value.trim();

  if (!name || number.length < 13 || expiry.length < 5 || !cvv) {
    alert('Please fill in all card details before processing.');
    return;
  }

  const last4 = number.slice(-4);
  const btn   = document.getElementById('btn-process-card');
  btn.disabled    = true;
  btn.textContent = 'Processing…';

  try {
    await fetch(`${API_BASE}/api/payment/cash`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        order_id: currentOrderId,
        amount:   currentOrderTotal,
        method:   'card_phone',
        ref:      `****${last4}`,
      }),
    });
  } catch { /* non-critical */ }

  btn.disabled    = false;
  btn.textContent = '💳 Process Payment';
  const orderId = currentOrderId;
  closeCardPhone();
  closeConfirm();
  showReceipt(orderId, `Card ••••${last4}`);
}

function cashOnDelivery() {
  // Driver will collect cash at the door — no payment recorded now
  closeConfirm();
}

function payAtPickup() {
  // Order is already saved in DB — customer will pay when they arrive
  // Kitchen display will show "Collect Payment" when order is ready
  closeConfirm();
}

async function simulateCard() {
  const btn = document.querySelector('.btn-simulate');
  btn.disabled = true;
  btn.textContent = 'Simulating…';
  try {
    const res = await fetch(`${API_BASE}/api/test/payment?order_id=${currentOrderId}`);
    const data = await res.json();
    if (data.ok) {
      const orderId = currentOrderId;
      closeConfirm();
      showReceipt(orderId, 'Card (Test)');
    } else {
      alert(data.detail || 'Simulation failed');
      btn.disabled = false;
      btn.textContent = '🧪 Simulate Card (Test)';
    }
  } catch {
    alert('Server error during simulation');
    btn.disabled = false;
    btn.textContent = '🧪 Simulate Card (Test)';
  }
}

// ── Kitchen ticket printing ───────────────────────────────────
function printKitchenTicket(orderId, type, items) {
  const typeLabel = { dine_in: 'DINE IN', carry_out: 'CARRY OUT', delivery: 'DELIVERY' }[type] || type.toUpperCase();
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  function fmtConfig(cfg) {
    if (!cfg) return [];
    const lines = [];
    if (cfg.sauce)           lines.push(`Sauce: ${cfg.sauce}`);
    if (cfg.toppings?.length) lines.push(`Toppings: ${cfg.toppings.join(', ')}`);
    if (cfg.cheese && cfg.cheese !== 'regular') lines.push(`Cheese: ${cfg.cheese}`);
    return lines;
  }

  let itemsHtml = '';
  for (const item of items) {
    const size = item.size ? ` (${item.size.toUpperCase()})` : '';
    itemsHtml += `<div class="kt-item"><div class="kt-name">${item.quantity}x ${item.name}${size}</div>`;
    if (item.is_half_half) {
      const l = fmtConfig(item.left_config);
      const r = fmtConfig(item.right_config);
      if (l.length) itemsHtml += `<div class="kt-mod">LEFT: ${l.join(' | ')}</div>`;
      if (r.length) itemsHtml += `<div class="kt-mod">RIGHT: ${r.join(' | ')}</div>`;
    } else {
      for (const line of fmtConfig(item.whole_config)) {
        itemsHtml += `<div class="kt-mod">${line}</div>`;
      }
    }
    if (item.notes) itemsHtml += `<div class="kt-notes">** ${item.notes} **</div>`;
    itemsHtml += `</div>`;
  }

  document.getElementById('kitchen-ticket-print').innerHTML = `
    <div class="kt-header">
      <div class="kt-order">ORDER #${orderId}</div>
      <div class="kt-type">${typeLabel}</div>
      <div class="kt-time">${time}</div>
    </div>
    <hr class="kt-divider">
    ${itemsHtml}
    <hr class="kt-divider">
  `;

  document.body.classList.add('printing-kitchen');
  window.print();
  document.body.classList.remove('printing-kitchen');
}

// ── Receipt printing ──────────────────────────────────────────
async function showReceipt(orderId, paymentMethod) {
  try {
    const res = await fetch(`${API_BASE}/api/orders/${orderId}`);
    if (!res.ok) return;
    const order = await res.json();
    document.getElementById('receipt-content').innerHTML = buildReceiptHtml(order, paymentMethod);
    document.getElementById('receipt-overlay').style.display = 'flex';
  } catch { /* non-critical */ }
}

function buildReceiptHtml(order, paymentMethod) {
  const isRefund  = paymentMethod.toLowerCase().includes('refund');
  const sign      = isRefund ? '-' : '';
  const typeLabel = { dine_in: 'Dine In', carry_out: 'Carry Out', delivery: 'Delivery' }[order.order_type] || order.order_type;
  const date      = new Date(order.created_at).toLocaleString();
  const itemsHtml = order.items.map(item => {
    const size = item.size ? ` (${item.size.toUpperCase()})` : '';
    return `<div class="r-item"><span class="r-item-name">${item.quantity}x ${item.name_snapshot}${size}</span><span>${sign}$${(item.item_price / 100).toFixed(2)}</span></div>`;
  }).join('');

  return `
    <div class="r-header">
      <div class="r-name">RUSTIC PIZZA</div>
      <div class="r-meta">Order #${order.id} &nbsp;·&nbsp; ${typeLabel}</div>
      <div class="r-date">${date}</div>
    </div>
    <hr class="r-divider">
    <div class="r-items">${itemsHtml}</div>
    <hr class="r-divider">
    <div class="r-totals">
      <div class="r-line"><span>Subtotal</span><span>${sign}$${(order.subtotal / 100).toFixed(2)}</span></div>
      <div class="r-line"><span>Tax</span><span>${sign}$${(order.tax / 100).toFixed(2)}</span></div>
      <div class="r-line r-total"><span>TOTAL</span><span>${sign}$${(order.total / 100).toFixed(2)}</span></div>
      <div class="r-line" style="margin-top:6px"><span>Payment</span><span>${paymentMethod}</span></div>
    </div>
    <div class="r-footer">${isRefund ? 'Refund processed. Sorry for the inconvenience.' : 'Thank you for dining with us!'}</div>
  `;
}

function closeReceipt() {
  document.getElementById('receipt-overlay').style.display = 'none';
}

// ── Schedule helpers ──────────────────────────────────────────
function toggleSchedule() {
  const fields = document.getElementById('schedule-fields');
  const btn    = document.getElementById('btn-schedule-toggle');
  const shown  = fields.style.display !== 'none';
  fields.style.display = shown ? 'none' : 'flex';
  btn.classList.toggle('active', !shown);
  if (shown) document.getElementById('schedule-dt').value = '';
}

function clearSchedule() {
  const fields = document.getElementById('schedule-fields');
  const btn    = document.getElementById('btn-schedule-toggle');
  if (fields) fields.style.display = 'none';
  if (btn) btn.classList.remove('active');
  const dt = document.getElementById('schedule-dt');
  if (dt) dt.value = '';
}

function closeConfirm() {
  document.getElementById('confirm-overlay').style.display = 'none';
  currentOrderId    = null;
  currentOrderTotal = 0;
  // Clear customer info fields for next order
  ['del-name', 'del-phone', 'del-notes', 'co-name', 'co-phone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  deliveryInfo = { name: '', phone: '', notes: '' };
}

// ── Custom item ───────────────────────────────────────────────
function openCustomItem() {
  document.getElementById('ci-name').value  = '';
  document.getElementById('ci-price').value = '';
  document.getElementById('custom-item-overlay').classList.add('open');
}

function closeCustomItem() {
  document.getElementById('custom-item-overlay').classList.remove('open');
}

function addCustomItemToCart() {
  const name     = document.getElementById('ci-name').value.trim();
  const priceRaw = parseFloat(document.getElementById('ci-price').value);
  if (!name)                       { alert('Please enter a description.');   return; }
  if (isNaN(priceRaw) || priceRaw <= 0) { alert('Please enter a valid price.'); return; }
  const price = Math.round(priceRaw * 100);
  pushToCart({ menu_item_id: null, name, size: null, price, quantity: 1, notes: '', detail: 'Custom' });
  closeCustomItem();
}

// ── Till Assignment (two-step startup: Clock In → Open Till) ─────
async function checkTillSession() {
  try {
    const res  = await fetch(`${API_BASE}/api/till/today`);
    const data = await res.json();
    if (!data.assigned || data.closed) {
      _showStartupOverlay();
    }
  } catch { /* non-blocking — if server unreachable, don't block POS */ }
}

function _showStartupOverlay() {
  // Reset to step 1
  document.getElementById('startup-step1').style.display = 'block';
  document.getElementById('startup-step2').style.display = 'none';
  document.getElementById('startup-emp-id').value = '';
  document.getElementById('startup-clock-err').textContent = '';
  const overlay = document.getElementById('till-assign-overlay');
  overlay.style.display = 'flex';
  setTimeout(() => document.getElementById('startup-emp-id').focus(), 50);
}

async function startupClockIn() {
  const empId = document.getElementById('startup-emp-id').value.trim();
  const errEl = document.getElementById('startup-clock-err');
  if (!empId) { errEl.textContent = 'Enter your Employee ID'; return; }
  errEl.textContent = '';
  try {
    const res  = await fetch(`${API_BASE}/api/shifts/clockin`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ employee_id: empId }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.detail || 'Clock-in failed'; return; }
    const time = new Date(data.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.getElementById('startup-clocked-banner').textContent =
      `✅ ${data.employee_name} clocked in at ${time}`;
    document.getElementById('startup-till-id').value = empId;
    document.getElementById('startup-till-err').textContent = '';
    document.getElementById('startup-step1').style.display = 'none';
    document.getElementById('startup-step2').style.display = 'block';
    setTimeout(() => document.getElementById('startup-till-id').focus(), 50);
  } catch { errEl.textContent = 'Cannot reach server'; }
}

function startupSkipToTill() {
  document.getElementById('startup-clocked-banner').textContent = 'Already clocked in — enter your Employee ID to open the till';
  document.getElementById('startup-till-id').value = '';
  document.getElementById('startup-till-err').textContent = '';
  document.getElementById('startup-step1').style.display = 'none';
  document.getElementById('startup-step2').style.display = 'block';
  setTimeout(() => document.getElementById('startup-till-id').focus(), 50);
}

async function startupOpenTill() {
  const empId = document.getElementById('startup-till-id').value.trim();
  const errEl = document.getElementById('startup-till-err');
  if (!empId) { errEl.textContent = 'Enter your Employee ID'; return; }
  errEl.textContent = '';
  try {
    const res  = await fetch(`${API_BASE}/api/till/open`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ employee_id: empId }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.detail || 'Failed to open till'; return; }
    document.getElementById('till-assign-overlay').style.display = 'none';
    const t = document.createElement('div');
    t.className = 'till-toast';
    t.textContent = `Till opened by ${data.employee_name}`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  } catch { errEl.textContent = 'Cannot reach server'; }
}

// ── Menu Picker ───────────────────────────────────────────────
function openMenuPicker() {
  const overlay = document.getElementById('menu-picker-overlay');
  overlay.style.display = 'flex';
}

function closeMenuPicker() {
  document.getElementById('menu-picker-overlay').style.display = 'none';
}

// ── Clock / Shifts Panel ──────────────────────────────────────
let _clockPanelTick = null;

function openClockPanel() {
  document.getElementById('clock-panel-overlay').style.display = 'flex';
  loadClockPanel();
  _clockPanelTick = setInterval(_tickClockPanel, 1000);
  _tickClockPanel();
}

function closeClockPanel() {
  document.getElementById('clock-panel-overlay').style.display = 'none';
  clearInterval(_clockPanelTick);
  _clockPanelTick = null;
}

function _tickClockPanel() {
  const now  = new Date();
  const el   = document.getElementById('cp-live-time');
  const del  = document.getElementById('cp-live-date');
  if (el)  el.textContent  = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (del) del.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

async function loadClockPanel() {
  const body = document.getElementById('clock-panel-body');
  if (body) body.innerHTML = '<div class="op-empty">Loading…</div>';
  try {
    const shifts = await fetch(`${API_BASE}/api/shifts/today`).then(r => r.json());
    renderClockPanel(shifts);
  } catch {
    if (body) body.innerHTML = '<div class="op-empty" style="color:#dc2626">Could not load shifts — check server connection.</div>';
  }
}

function renderClockPanel(shifts) {
  const body      = document.getElementById('clock-panel-body');
  const clockedIn = shifts.filter(s => s.is_clocked_in);

  const clockedInHtml = clockedIn.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">
        ${clockedIn.map(s => `<span class="clocked-in-chip">✅ ${s.employee_name} (${s.employee_id})</span>`).join('')}
       </div>`
    : '<div style="color:#64748b;font-size:0.87rem;margin-top:6px">Nobody clocked in yet today</div>';

  const shiftsHtml = shifts.length
    ? shifts.map(s => {
        const ci   = new Date(s.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const co   = s.clock_out ? new Date(s.clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
        const hrs  = s.hours_worked !== null ? `${s.hours_worked}h` : 'ongoing';
        const dot  = s.is_clocked_in
          ? '<span style="width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block"></span>'
          : '<span style="width:8px;height:8px;border-radius:50%;background:#94a3b8;display:inline-block"></span>';
        return `<div class="clocked-out-chip">
          ${dot}
          <span style="flex:1;font-weight:600;color:#1e293b">${s.employee_name}</span>
          <span style="color:#64748b;font-size:0.82rem">${ci} → ${co}</span>
          <span style="color:#94a3b8;font-size:0.8rem;min-width:50px;text-align:right">${hrs}</span>
        </div>`;
      }).join('')
    : '<div style="color:#94a3b8;font-size:0.85rem">No shifts recorded today</div>';

  body.innerHTML = `
    <div style="max-width:560px;margin:0 auto">
      <div class="clock-panel-time-card">
        <div class="clock-panel-time" id="cp-live-time">--:--:--</div>
        <div class="clock-panel-date" id="cp-live-date">—</div>
      </div>

      <div class="cash-summary-card" style="margin-bottom:16px">
        <div style="font-size:0.78rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Currently On Shift</div>
        ${clockedInHtml}
      </div>

      <div class="cash-summary-card" style="margin-bottom:16px">
        <div style="font-size:0.78rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">Clock In / Clock Out</div>
        <input class="clock-panel-emp-input" id="cp-emp-id" type="text" placeholder="Employee ID" autocomplete="off" />
        <div class="clock-panel-btns">
          <button class="clock-panel-in-btn" onclick="panelClockIn()">✅ Clock In</button>
          <button class="clock-panel-out-btn" onclick="panelClockOut()">🚪 Clock Out</button>
        </div>
        <div class="clock-panel-result" id="cp-result"></div>
      </div>

      <div class="cash-summary-card">
        <div style="font-size:0.78rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">Today's Shifts</div>
        ${shiftsHtml}
      </div>
    </div>`;

  _tickClockPanel();
}

async function panelClockIn() {
  const empId = (document.getElementById('cp-emp-id')?.value || '').trim();
  const result = document.getElementById('cp-result');
  if (!empId) { result.textContent = 'Enter your Employee ID'; result.className = 'clock-panel-result error'; return; }
  try {
    const res  = await fetch(`${API_BASE}/api/shifts/clockin`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ employee_id: empId }),
    });
    const data = await res.json();
    if (res.ok) {
      const time = new Date(data.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      result.textContent = `✅ ${data.employee_name} clocked in at ${time}`;
      result.className = 'clock-panel-result success';
      setTimeout(loadClockPanel, 1500);
    } else {
      result.textContent = data.detail || 'Clock-in failed';
      result.className = 'clock-panel-result error';
    }
  } catch { result.textContent = 'Cannot reach server'; result.className = 'clock-panel-result error'; }
}

async function panelClockOut() {
  const empId = (document.getElementById('cp-emp-id')?.value || '').trim();
  const result = document.getElementById('cp-result');
  if (!empId) { result.textContent = 'Enter your Employee ID'; result.className = 'clock-panel-result error'; return; }

  // Block clock-out if the till is currently open and assigned to this employee
  try {
    const tillRes = await fetch(`${API_BASE}/api/till/today`);
    if (tillRes.ok) {
      const session = await tillRes.json();
      if (session.assigned && !session.closed && session.employee_id === empId) {
        result.textContent = '⚠️ The till is assigned to you — reassign it to the closing employee before clocking out.';
        result.className = 'clock-panel-result error';
        return;
      }
    }
  } catch { /* till check failed — let the server handle it */ }

  try {
    const res  = await fetch(`${API_BASE}/api/shifts/clockout`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ employee_id: empId }),
    });
    const data = await res.json();
    if (res.ok) {
      const time = new Date(data.clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      result.textContent = `🚪 ${data.employee_name} clocked out at ${time} · ${data.hours_worked}h`;
      result.className = 'clock-panel-result success';
      setTimeout(loadClockPanel, 1800);
    } else {
      result.textContent = data.detail || 'Clock-out failed';
      result.className = 'clock-panel-result error';
    }
  } catch { result.textContent = 'Cannot reach server'; result.className = 'clock-panel-result error'; }
}

// ── Start ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
