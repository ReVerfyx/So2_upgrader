/* =========================================================================
   core.js — общее для всех страниц: утилиты, курс TON, корзина, тосты.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.SITE_CONFIG || {};
  var LS_CART = 'so2:cart';
  var LS_ORDERS = 'so2:orders';
  var LS_RATE = 'so2:rate';
  var LS_PROFILE = 'so2:profile';

  /* ---------------- storage (не падаем в приватном режиме) ---------------- */
  function lsGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  /* ---------------- формат ---------------- */
  var nfRub = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  var nfNum = new Intl.NumberFormat('ru-RU');

  function rub(n) { return nfRub.format(Math.round(Number(n) || 0)) + ' ₽'; }
  function num(n) { return nfNum.format(Number(n) || 0); }
  function ton(n) {
    var v = Number(n) || 0;
    return (v < 10 ? v.toFixed(4) : v.toFixed(3)).replace(/0+$/, '').replace(/\.$/, '') + ' TON';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  /* ---------------- toasts ---------------- */
  function toast(text, kind) {
    var box = document.getElementById('toaster');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast--' + kind : '');
    el.textContent = text;
    box.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 260);
    }, 2600);
  }

  /* ---------------- копирование ---------------- */
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  // любой элемент с data-copy="текст" — кнопка копирования
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy]');
    if (!btn) return;
    var value = btn.getAttribute('data-copy');
    copy(value).then(function () {
      toast('Скопировано', 'ok');
      var prev = btn.textContent;
      if (btn.classList.contains('copy-btn')) {
        btn.classList.add('is-done');
        btn.textContent = 'Готово';
        setTimeout(function () { btn.classList.remove('is-done'); btn.textContent = prev; }, 1600);
      }
    }).catch(function () { toast('Не удалось скопировать — выделите вручную', 'err'); });
  });

  /* ---------------- курс TON ---------------- */
  var rateState = { value: (CFG.money && CFG.money.fallbackRate) || 270, live: false };

  function getCachedRate() {
    var c = lsGet(LS_RATE, null);
    if (!c || !c.value || !c.ts) return null;
    var ttl = ((CFG.money && CFG.money.rateTtlMin) || 10) * 60 * 1000;
    return (Date.now() - c.ts < ttl) ? c : null;
  }

  function applyRate(value, live) {
    rateState.value = value;
    rateState.live = !!live;
    var el = document.getElementById('rate-value');
    if (el) el.textContent = 'TON ≈ ' + rub(value);
    document.dispatchEvent(new CustomEvent('rate:change', { detail: rateState }));
  }

  function loadRate() {
    var cached = getCachedRate();
    if (cached) { applyRate(cached.value, true); return Promise.resolve(rateState); }

    var url = CFG.money && CFG.money.rateApi;
    if (!url) { applyRate(rateState.value, false); return Promise.resolve(rateState); }

    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)); })
      .then(function (d) {
        var v = d && d.rates && d.rates.TON && d.rates.TON.prices &&
                (d.rates.TON.prices.RUB || d.rates.TON.prices.rub);
        if (!v || !isFinite(v)) throw new Error('bad payload');
        lsSet(LS_RATE, { value: v, ts: Date.now() });
        applyRate(v, true);
        return rateState;
      })
      .catch(function () {
        applyRate(rateState.value, false);   // тихо откатываемся на курс из конфига
        return rateState;
      });
  }

  /** ₽ -> TON с учётом минимального перевода в сети. */
  function rubToTon(amountRub) {
    var raw = (Number(amountRub) || 0) / (rateState.value || 1);
    var min = (CFG.ton && CFG.ton.minTon) || 0;
    return Math.max(raw, min);
  }
  /** Округляем вверх до 4 знаков — чтобы платёж точно был не меньше нужного. */
  function roundTon(v) { return Math.ceil((Number(v) || 0) * 1e4) / 1e4; }

  /* ---------------- корзина ---------------- */
  function cartRead() {
    var items = lsGet(LS_CART, []);
    return Array.isArray(items) ? items.filter(function (i) { return i && i.id && i.price > 0; }) : [];
  }
  function cartWrite(items) {
    lsSet(LS_CART, items);
    renderCartCount();
    document.dispatchEvent(new CustomEvent('cart:change', { detail: items }));
  }
  function cartAdd(item, qty) {
    var items = cartRead();
    var found = null;
    for (var i = 0; i < items.length; i++) if (items[i].id === item.id) { found = items[i]; break; }
    if (found) found.qty += (qty || 1);
    else items.push({
      id: item.id, kind: item.kind || 'gold', title: item.title,
      sub: item.sub || '', price: Number(item.price), qty: qty || 1,
      gold: item.gold || 0, img: item.img || ''
    });
    cartWrite(items);
  }
  function cartSetQty(id, qty) {
    var items = cartRead().map(function (i) {
      if (i.id === id) i.qty = Math.max(1, Math.min(99, qty));
      return i;
    });
    cartWrite(items);
  }
  function cartRemove(id) {
    cartWrite(cartRead().filter(function (i) { return i.id !== id; }));
  }
  function cartClear() { cartWrite([]); }
  function cartTotal() {
    return cartRead().reduce(function (s, i) { return s + i.price * i.qty; }, 0);
  }
  function cartCount() {
    return cartRead().reduce(function (s, i) { return s + i.qty; }, 0);
  }
  function renderCartCount() {
    var el = document.getElementById('cart-count');
    if (!el) return;
    var n = cartCount();
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = n === 0;
  }

  /* ---------------- заказы ---------------- */
  function ordersRead() {
    var list = lsGet(LS_ORDERS, []);
    return Array.isArray(list) ? list : [];
  }
  function ordersSave(list) { lsSet(LS_ORDERS, list.slice(0, 50)); }
  function orderAdd(order) {
    var list = ordersRead();
    list.unshift(order);
    ordersSave(list);
  }
  function orderGet(id) {
    var list = ordersRead();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function orderUpdate(id, patch) {
    var list = ordersRead();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { Object.assign(list[i], patch); ordersSave(list); return list[i]; }
    }
    return null;
  }
  /** Номер заказа = комментарий к переводу. Короткий, без похожих символов. */
  function newOrderId() {
    var abc = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    var buf = new Uint32Array(6), out = '';
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < 6; i++) out += abc[buf[i] % abc.length];
    return (CFG.orderPrefix || 'SO2') + '-' + out;
  }

  /* ---------------- профиль (ник/ID, чтобы не вводить каждый раз) -------- */
  function profileRead() { return lsGet(LS_PROFILE, {}) || {}; }
  function profileSave(p) { lsSet(LS_PROFILE, p); }

  /* ---------------- меню ---------------- */
  function initHeader() {
    var burger = document.getElementById('burger');
    var nav = document.getElementById('nav');
    if (!burger || !nav) return;
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nav.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------------- загрузка каталога ---------------- */
  var dataCache = {};
  function loadData(name) {
    if (dataCache[name]) return dataCache[name];
    dataCache[name] = fetch('data/' + name + '.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)); })
      .catch(function (e) {
        console.error('Не удалось загрузить data/' + name + '.json', e);
        return null;
      });
    return dataCache[name];
  }

  /* ---------------- экспорт ---------------- */
  window.SO2 = {
    cfg: CFG,
    lsGet: lsGet, lsSet: lsSet,
    rub: rub, num: num, ton: ton, esc: esc, plural: plural,
    toast: toast, copy: copy,
    rate: rateState, loadRate: loadRate, rubToTon: rubToTon, roundTon: roundTon,
    cart: {
      read: cartRead, add: cartAdd, setQty: cartSetQty, remove: cartRemove,
      clear: cartClear, total: cartTotal, count: cartCount
    },
    orders: {
      read: ordersRead, add: orderAdd, get: orderGet, update: orderUpdate, newId: newOrderId
    },
    profile: { read: profileRead, save: profileSave },
    loadData: loadData
  };

  /* ---------------- старт ---------------- */
  function start() {
    initHeader();
    renderCartCount();
    loadRate();
    // курс мог протухнуть, пока вкладка висела открытой
    setInterval(loadRate, ((CFG.money && CFG.money.rateTtlMin) || 10) * 60 * 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
