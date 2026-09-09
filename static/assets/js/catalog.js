/* =========================================================================
   catalog.js — вывод пакетов голды и скинов + калькулятор произвольной суммы.
   Работает на index.html, gold.html и skins.html: рисует то, что найдёт в DOM.
   ========================================================================= */
(function () {
  'use strict';

  var S = window.SO2;
  var CFG = window.SITE_CONFIG || {};
  var MIN_RUB = (CFG.money && CFG.money.minRub) || 50;
  var GOLD_PRICE = (CFG.money && CFG.money.goldPriceRub) || 0.72;

  var TAGS = {
    hit:    { cls: 'badge--hot', text: 'Хит' },
    profit: { cls: 'badge--new', text: 'Выгодно' },
    new:    { cls: 'badge--new', text: 'Новинка' }
  };

  var COIN = '<svg class="gold-coin" viewBox="0 0 40 40" aria-hidden="true">' +
    '<circle cx="20" cy="20" r="17" fill="none" stroke="#fbd506" stroke-width="2.5"/>' +
    '<circle cx="20" cy="20" r="11" fill="none" stroke="#fbd506" stroke-width="1.5" opacity=".55"/>' +
    '<path d="M20 12v16M15.5 16.5h9M15.5 23.5h9" stroke="#fbd506" stroke-width="2.2" stroke-linecap="round"/></svg>';

  /* --------------------------- пакеты голды --------------------------- */

  function goldCard(p) {
    var total = p.amount + (p.bonus || 0);
    var tag = TAGS[p.tag];
    var tonPrice = S.roundTon(S.rubToTon(p.priceRub));
    return '' +
      '<article class="card' + (p.tag === 'hit' ? ' card--hot' : '') + '">' +
        (tag ? '<span class="card-flag badge ' + tag.cls + '">' + tag.text + '</span>' : '') +
        '<div class="gold-visual">' + COIN +
          '<span class="gold-amount">' + S.num(p.amount) + '</span>' +
        '</div>' +
        (p.bonus ? '<div class="card-bonus">+ ' + S.num(p.bonus) + ' голды бонусом</div>' : '<div class="card-bonus">&nbsp;</div>') +
        '<h3 class="card-title">' + S.num(total) + ' голды</h3>' +
        '<p class="card-sub">Зачисление на аккаунт Standoff 2</p>' +
        '<div class="card-foot">' +
          '<span class="price">' +
            '<b>' + S.rub(p.priceRub) + '</b>' +
            (p.oldPriceRub && p.oldPriceRub > p.priceRub ? '<s>' + S.rub(p.oldPriceRub) + '</s>' : '') +
            '<i data-ton-for="' + p.priceRub + '">≈ ' + S.ton(tonPrice) + '</i>' +
          '</span>' +
          '<button class="btn btn-primary btn-sm" data-add-gold="' + p.id + '">В корзину</button>' +
        '</div>' +
      '</article>';
  }

  function renderGold(packs) {
    document.querySelectorAll('[data-gold-grid]').forEach(function (grid) {
      var limit = parseInt(grid.getAttribute('data-limit') || '0', 10);
      var list = limit > 0 ? packs.slice(0, limit) : packs;
      grid.innerHTML = list.map(goldCard).join('');
      grid.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-add-gold]');
        if (!btn) return;
        var pack = packs.filter(function (p) { return p.id === btn.getAttribute('data-add-gold'); })[0];
        if (!pack) return;
        var total = pack.amount + (pack.bonus || 0);
        S.cart.add({
          id: pack.id, kind: 'gold', title: S.num(total) + ' голды',
          sub: 'Пакет ' + S.num(pack.amount) + (pack.bonus ? ' + ' + S.num(pack.bonus) + ' бонус' : ''),
          price: pack.priceRub, gold: total
        });
        S.toast('Добавлено в корзину', 'ok');
      });
    });
  }

  /* ------------------------------ скины ------------------------------- */

  var skinState = { all: [], rarities: {}, q: '', rarity: '', sort: 'pop' };

  function skinCard(it, rarities) {
    var r = rarities[it.rarity] || { title: '', color: '#555' };
    var out = it.stock === 0;
    var tonPrice = S.roundTon(S.rubToTon(it.priceRub));
    var visual = it.img
      ? '<img src="' + S.esc(it.img) + '" alt="' + S.esc(it.weapon + ' | ' + it.name) + '" loading="lazy">'
      : '<span class="weapon-glyph">' + S.esc(it.weapon) + '</span>';

    return '' +
      '<article class="card" data-skin="' + S.esc(it.id) + '">' +
        (out ? '<span class="card-flag badge badge--out">Нет в наличии</span>' : '') +
        '<div class="skin-visual" style="--rarity:' + r.color + '">' + visual +
          '<span class="skin-rarity"></span>' +
        '</div>' +
        '<h3 class="card-title">' + S.esc(it.weapon) + ' | ' + S.esc(it.name) + '</h3>' +
        '<p class="card-sub" style="color:' + r.color + '">' + S.esc(r.title) +
          (it.stock > 0 ? ' · в наличии ' + it.stock + ' ' + S.plural(it.stock, 'шт.', 'шт.', 'шт.') : '') + '</p>' +
        '<div class="card-foot">' +
          '<span class="price"><b>' + S.rub(it.priceRub) + '</b>' +
            '<i data-ton-for="' + it.priceRub + '">≈ ' + S.ton(tonPrice) + '</i></span>' +
          (out
            ? '<button class="btn btn-ghost btn-sm" disabled>Нет</button>'
            : '<button class="btn btn-primary btn-sm" data-add-skin="' + S.esc(it.id) + '">В корзину</button>') +
        '</div>' +
      '</article>';
  }

  function applyFilters() {
    var list = skinState.all.slice();
    var q = skinState.q.trim().toLowerCase();
    if (q) {
      list = list.filter(function (i) {
        return (i.weapon + ' ' + i.name).toLowerCase().indexOf(q) !== -1;
      });
    }
    if (skinState.rarity) {
      list = list.filter(function (i) { return i.rarity === skinState.rarity; });
    }
    if (skinState.sort === 'asc') list.sort(function (a, b) { return a.priceRub - b.priceRub; });
    else if (skinState.sort === 'desc') list.sort(function (a, b) { return b.priceRub - a.priceRub; });
    else list.sort(function (a, b) { return (b.stock > 0) - (a.stock > 0) || b.priceRub - a.priceRub; });
    return list;
  }

  function renderSkins() {
    document.querySelectorAll('[data-skins-grid]').forEach(function (grid) {
      var limit = parseInt(grid.getAttribute('data-limit') || '0', 10);
      var list = grid.hasAttribute('data-no-filter') ? skinState.all.slice() : applyFilters();
      if (limit > 0) list = list.slice(0, limit);

      grid.innerHTML = list.length
        ? list.map(function (i) { return skinCard(i, skinState.rarities); }).join('')
        : '<p class="empty muted" style="grid-column:1/-1">По вашему запросу ничего не нашлось. ' +
          'Нужного скина нет в списке? <a class="accent" href="' + S.esc(CFG.contacts.telegram) + '" target="_blank" rel="noopener">Напишите нам</a> — привезём под заказ.</p>';

      var counter = document.getElementById('skins-count');
      if (counter) counter.textContent = list.length + ' ' + S.plural(list.length, 'предмет', 'предмета', 'предметов');
    });
  }

  function initSkinFilters() {
    var q = document.getElementById('skin-search');
    var rar = document.getElementById('skin-rarity');
    var sort = document.getElementById('skin-sort');

    if (rar && skinState.rarities) {
      var opts = ['<option value="">Все редкости</option>'];
      Object.keys(skinState.rarities).forEach(function (k) {
        opts.push('<option value="' + k + '">' + S.esc(skinState.rarities[k].title) + '</option>');
      });
      rar.innerHTML = opts.join('');
    }
    if (q) q.addEventListener('input', function () { skinState.q = q.value; renderSkins(); });
    if (rar) rar.addEventListener('change', function () { skinState.rarity = rar.value; renderSkins(); });
    if (sort) sort.addEventListener('change', function () { skinState.sort = sort.value; renderSkins(); });

    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-add-skin]');
      if (!btn) return;
      var id = btn.getAttribute('data-add-skin');
      var it = skinState.all.filter(function (i) { return i.id === id; })[0];
      if (!it) return;
      S.cart.add({
        id: it.id, kind: 'skin', title: it.weapon + ' | ' + it.name,
        sub: (skinState.rarities[it.rarity] || {}).title || '', price: it.priceRub, img: it.img
      });
      S.toast('Скин добавлен в корзину', 'ok');
    });
  }

  /* ----------------------- калькулятор произвольной суммы ------------------ */

  function initCalc() {
    var input = document.getElementById('calc-input');
    if (!input) return;
    var outGold = document.getElementById('calc-gold');
    var outTon = document.getElementById('calc-ton');
    var btn = document.getElementById('calc-add');
    var err = document.getElementById('calc-error');

    function recalc() {
      var rubValue = Math.floor(Number(input.value) || 0);
      var gold = Math.floor(rubValue / GOLD_PRICE);
      var tonValue = S.roundTon(S.rubToTon(rubValue));
      if (outGold) outGold.textContent = S.num(gold);
      if (outTon) outTon.textContent = rubValue > 0 ? '≈ ' + S.ton(tonValue) : '—';

      var bad = rubValue < MIN_RUB;
      if (err) err.hidden = !bad || !input.value;
      if (btn) btn.disabled = bad;
      return { rub: rubValue, gold: gold };
    }

    input.addEventListener('input', recalc);
    document.addEventListener('rate:change', recalc);

    document.querySelectorAll('[data-calc-preset]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        input.value = chip.getAttribute('data-calc-preset');
        document.querySelectorAll('[data-calc-preset]').forEach(function (c) { c.classList.remove('is-active'); });
        chip.classList.add('is-active');
        recalc();
      });
    });

    if (btn) {
      btn.addEventListener('click', function () {
        var r = recalc();
        if (r.rub < MIN_RUB) { S.toast('Минимальный заказ — ' + S.rub(MIN_RUB), 'err'); return; }
        S.cart.add({
          id: 'gold-custom-' + r.rub, kind: 'gold',
          title: S.num(r.gold) + ' голды',
          sub: 'Произвольная сумма', price: r.rub, gold: r.gold
        });
        S.toast('Добавлено в корзину', 'ok');
      });
    }
    recalc();
  }

  /* ------------------- пересчёт цен в TON при смене курса ----------------- */
  document.addEventListener('rate:change', function () {
    document.querySelectorAll('[data-ton-for]').forEach(function (el) {
      var r = Number(el.getAttribute('data-ton-for'));
      el.textContent = '≈ ' + S.ton(S.roundTon(S.rubToTon(r)));
    });
  });

  /* ------------------------------- старт --------------------------------- */
  function start() {
    initCalc();

    if (document.querySelector('[data-gold-grid]')) {
      S.loadData('gold').then(function (d) {
        if (d && d.packs) renderGold(d.packs);
      });
    }
    if (document.querySelector('[data-skins-grid]')) {
      S.loadData('skins').then(function (d) {
        if (!d || !d.items) return;
        skinState.all = d.items;
        skinState.rarities = d.rarities || {};
        initSkinFilters();
        renderSkins();
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
