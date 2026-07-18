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

  // Category buttons
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showCategory(btn.dataset.cat);
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

  // Default category
  document.querySelector('.cat-btn[data-cat="pizza"]').classList.add('active');
  showCategory('pizza');
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

    cart = [];
    renderCart();
    clearSchedule();
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
  try {
    await fetch(`${API_BASE}/api/payment/cash`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ order_id: currentOrderId, amount: currentOrderTotal, method: 'cash' }),
    });
  } catch { /* non-critical */ }
  closeConfirm();
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
  closeCardPhone();
  closeConfirm();
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
      alert(`✅ Payment simulated!\nReceipt saved to:\nbackend/test_prints/receipt_order_${currentOrderId}.txt`);
      closeConfirm();
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

// ── Start ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
