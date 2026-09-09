/* =========================================================================
   orders.js — «Мои заказы»: список из localStorage + повторная проверка оплаты.
   ========================================================================= */
(function () {
  'use strict';

  var S = window.SO2;
  var CFG = window.SITE_CONFIG || {};
  var list = document.getElementById('orders-list');
  if (!list) return;

  var empty = document.getElementById('orders-empty');

  var LABEL = {
    wait:    { text: 'Ожидает оплаты', status: 'wait' },
    paid:    { text: 'Оплачен, в работе', status: 'paid' },
    done:    { text: 'Выдан', status: 'done' },
    expired: { text: 'Отменён', status: 'expired' }
  };

  function fmtDate(ts) {
    try {
      return new Date(ts).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return ''; }
  }

  function card(o) {
    var l = LABEL[o.status] || LABEL.wait;
    var items = o.items.map(function (i) {
      return S.esc(i.title) + (i.qty > 1 ? ' × ' + i.qty : '');
    }).join(', ');

    return '' +
      '<article class="order-card">' +
        '<header>' +
          '<span class="order-id">' + S.esc(o.id) + '</span>' +
          '<span class="status-pill" data-status="' + l.status + '">' + l.text + '</span>' +
        '</header>' +
        '<p class="small muted mb-0">' + items + '</p>' +
        '<p class="small muted">' + S.rub(o.totalRub) + ' · ' + S.ton(o.amountTon) +
          ' · ' + fmtDate(o.createdAt) + '</p>' +
        '<p class="small muted">Ник: <b>' + S.esc(o.nickname) + '</b> · ID: <b>' + S.esc(o.playerId) + '</b></p>' +
        '<div class="hero-cta mt-16">' +
          '<a class="btn btn-ghost btn-sm" href="checkout.html?id=' + encodeURIComponent(o.id) + '">' +
            (o.status === 'wait' ? 'Оплатить' : 'Реквизиты') + '</a>' +
          (o.status === 'wait'
            ? '<button class="btn btn-outline btn-sm" data-recheck="' + S.esc(o.id) + '">Проверить оплату</button>'
            : '') +
          '<a class="btn btn-outline btn-sm" href="' + S.esc(CFG.contacts.telegram) + '?text=' +
            encodeURIComponent('Заказ ' + o.id) + '" target="_blank" rel="noopener">Написать оператору</a>' +
        '</div>' +
      '</article>';
  }

  function render() {
    var orders = S.orders.read();
    if (!orders.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = orders.map(card).join('');
  }

  list.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-recheck]');
    if (!btn) return;
    var id = btn.getAttribute('data-recheck');
    var o = S.orders.get(id);
    if (!o) return;

    btn.disabled = true;
    btn.textContent = 'Проверяем…';

    window.TONPAY.checkPayment(o.id, o.amountTon, o.createdAt)
      .then(function (res) {
        if (res.status === 'paid') {
          S.orders.update(o.id, { status: 'paid', paidAt: Date.now(), paidTon: res.paid,
                                  txHash: (res.tx && res.tx.hash) || '' });
          S.toast('Оплата найдена', 'ok');
          render();
        } else if (res.status === 'underpaid') {
          S.toast('Пришло ' + S.ton(res.paid) + ' — не хватает ' + S.ton(res.need), 'err');
        } else {
          S.toast('Платёж пока не виден в блокчейне', 'err');
        }
      })
      .catch(function () { S.toast('Сервисы TON недоступны, попробуйте позже', 'err'); })
      .then(function () { btn.disabled = false; btn.textContent = 'Проверить оплату'; });
  });

  /* поиск заказа по номеру (например, открыли с другого устройства) */
  var findForm = document.getElementById('find-order');
  if (findForm) {
    findForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var id = findForm.elements.orderId.value.trim().toUpperCase();
      if (!id) return;
      if (S.orders.get(id)) { location.href = 'checkout.html?id=' + encodeURIComponent(id); return; }
      S.toast('Заказ не найден в этом браузере — напишите номер оператору', 'err');
      var help = document.getElementById('find-help');
      if (help) {
        help.hidden = false;
        var a = help.querySelector('a');
        if (a) a.href = CFG.contacts.telegram + '?text=' + encodeURIComponent('Заказ ' + id);
      }
    });
  }

  render();
})();
