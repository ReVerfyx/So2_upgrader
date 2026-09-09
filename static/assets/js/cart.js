/* =========================================================================
   cart.js — корзина и оформление заказа.
   Заказ создаётся локально (без бэкенда): номер заказа = комментарий
   к переводу TON, по нему платёж и опознаётся.
   ========================================================================= */
(function () {
  'use strict';

  var S = window.SO2;
  var CFG = window.SITE_CONFIG || {};
  var MIN_RUB = (CFG.money && CFG.money.minRub) || 50;
  var MIN_TON = (CFG.ton && CFG.ton.minTon) || 0;

  var elItems = document.getElementById('cart-items');
  if (!elItems) return;

  var elEmpty = document.getElementById('cart-empty');
  var elBody = document.getElementById('cart-body');
  var elSubtotal = document.getElementById('sum-subtotal');
  var elTotal = document.getElementById('sum-total');
  var elTon = document.getElementById('sum-ton');
  var elMinNote = document.getElementById('min-ton-note');
  var form = document.getElementById('order-form');

  /* ------------------------------ отрисовка ------------------------------ */

  function thumb(item) {
    if (item.img) return '<img src="' + S.esc(item.img) + '" alt="" class="li-thumb" style="object-fit:contain">';
    if (item.kind === 'gold') return '<span class="li-thumb">GOLD</span>';
    return '<span class="li-thumb">SKIN</span>';
  }

  function render() {
    var items = S.cart.read();

    if (!items.length) {
      elEmpty.hidden = false;
      elBody.hidden = true;
      return;
    }
    elEmpty.hidden = true;
    elBody.hidden = false;

    elItems.innerHTML = items.map(function (i) {
      return '' +
        '<div class="line-item">' +
          thumb(i) +
          '<div class="li-main"><b>' + S.esc(i.title) + '</b><span>' + S.esc(i.sub || '') + '</span></div>' +
          '<div class="qty">' +
            '<button type="button" data-qty="-" data-id="' + S.esc(i.id) + '" aria-label="Меньше">−</button>' +
            '<span>' + i.qty + '</span>' +
            '<button type="button" data-qty="+" data-id="' + S.esc(i.id) + '" aria-label="Больше">+</button>' +
          '</div>' +
          '<div class="li-price">' + S.rub(i.price * i.qty) + '</div>' +
          '<button type="button" class="li-del" data-del="' + S.esc(i.id) + '" aria-label="Удалить">×</button>' +
        '</div>';
    }).join('');

    var total = S.cart.total();
    var tonAmount = S.roundTon(S.rubToTon(total));

    elSubtotal.textContent = S.rub(total);
    elTotal.innerHTML = '<b>' + S.rub(total) + '</b>';
    elTon.textContent = '≈ ' + S.ton(tonAmount);

    // Если заказ дешевле минимального перевода в сети — честно предупреждаем.
    if (elMinNote) {
      var rawTon = total / (S.rate.value || 1);
      elMinNote.hidden = !(MIN_TON > 0 && rawTon < MIN_TON);
      var span = document.getElementById('min-ton-value');
      if (span) span.textContent = S.ton(MIN_TON);
    }

    var submit = document.getElementById('order-submit');
    if (submit) submit.disabled = total < MIN_RUB;
  }

  elItems.addEventListener('click', function (e) {
    var q = e.target.closest('[data-qty]');
    if (q) {
      var id = q.getAttribute('data-id');
      var cur = S.cart.read().filter(function (i) { return i.id === id; })[0];
      if (cur) S.cart.setQty(id, cur.qty + (q.getAttribute('data-qty') === '+' ? 1 : -1));
      return;
    }
    var d = e.target.closest('[data-del]');
    if (d) {
      S.cart.remove(d.getAttribute('data-del'));
      S.toast('Удалено');
    }
  });

  var clearBtn = document.getElementById('cart-clear');
  if (clearBtn) clearBtn.addEventListener('click', function () {
    if (S.cart.count() && confirm('Очистить корзину?')) { S.cart.clear(); S.toast('Корзина очищена'); }
  });

  document.addEventListener('cart:change', render);
  document.addEventListener('rate:change', render);

  /* ------------------------------ валидация ------------------------------ */

  var RULES = {
    nickname: {
      test: function (v) { return v.length >= 3 && v.length <= 24; },
      msg: 'Ник в игре: от 3 до 24 символов'
    },
    playerId: {
      test: function (v) { return /^[0-9]{5,15}$/.test(v.replace(/\s/g, '')); },
      msg: 'ID игрока — только цифры, 5–15 знаков (профиль → значок ID)'
    },
    contact: {
      test: function (v) { return v.length >= 3; },
      msg: 'Укажите @username в Telegram или e-mail для связи'
    }
  };

  function validateField(input) {
    var rule = RULES[input.name];
    if (!rule) return true;
    var ok = rule.test(input.value.trim());
    input.setAttribute('aria-invalid', ok ? 'false' : 'true');
    var box = document.querySelector('[data-error-for="' + input.name + '"]');
    if (box) { box.textContent = ok ? '' : rule.msg; box.hidden = ok; }
    return ok;
  }

  if (form) {
    // подставляем данные из прошлого заказа
    var saved = S.profile.read();
    ['nickname', 'playerId', 'contact'].forEach(function (n) {
      if (saved[n] && form.elements[n]) form.elements[n].value = saved[n];
    });

    form.addEventListener('input', function (e) {
      if (e.target.name && RULES[e.target.name]) validateField(e.target);
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var items = S.cart.read();
      if (!items.length) { S.toast('Корзина пуста', 'err'); return; }

      var ok = true;
      ['nickname', 'playerId', 'contact'].forEach(function (n) {
        if (form.elements[n] && !validateField(form.elements[n])) ok = false;
      });
      if (!form.elements.agree.checked) {
        S.toast('Подтвердите согласие с условиями', 'err');
        ok = false;
      }
      if (!ok) return;

      var total = S.cart.total();
      if (total < MIN_RUB) { S.toast('Минимальный заказ — ' + S.rub(MIN_RUB), 'err'); return; }

      var profile = {
        nickname: form.elements.nickname.value.trim(),
        playerId: form.elements.playerId.value.replace(/\s/g, ''),
        contact: form.elements.contact.value.trim()
      };
      S.profile.save(profile);

      var order = {
        id: S.orders.newId(),
        createdAt: Date.now(),
        status: 'wait',               // wait -> paid -> done
        items: items,
        totalRub: total,
        rate: S.rate.value,
        amountTon: S.roundTon(S.rubToTon(total)),
        nickname: profile.nickname,
        playerId: profile.playerId,
        contact: profile.contact,
        comment: (form.elements.note ? form.elements.note.value.trim() : '')
      };

      S.orders.add(order);
      S.cart.clear();
      location.href = 'checkout.html?id=' + encodeURIComponent(order.id);
    });
  }

  render();
})();
