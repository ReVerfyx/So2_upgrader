/* =========================================================================
   checkout.js — страница оплаты заказа.
   Показывает адрес, сумму и комментарий, рисует QR и сам проверяет
   поступление платежа через публичные API TON.
   ========================================================================= */
(function () {
  'use strict';

  var S = window.SO2;
  var CFG = window.SITE_CONFIG || {};
  var root = document.getElementById('checkout');
  if (!root) return;

  var PAY_WINDOW_MIN = 60;          // сколько держим цену по курсу заказа
  var POLL_MS = 15000;              // как часто опрашиваем блокчейн

  var params = new URLSearchParams(location.search);
  var orderId = (params.get('id') || '').toUpperCase();
  var order = orderId ? S.orders.get(orderId) : null;

  var elNotFound = document.getElementById('co-notfound');
  var elBody = document.getElementById('co-body');

  if (!order) {
    if (elNotFound) elNotFound.hidden = false;
    if (elBody) elBody.hidden = true;
    return;
  }
  if (elNotFound) elNotFound.hidden = true;
  if (elBody) elBody.hidden = false;

  var amountTon = S.roundTon(order.amountTon);
  var payLink = window.TONPAY.payLink(amountTon, order.id);

  /* ------------------------------ отрисовка ------------------------------ */

  function fill(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }
  function setCopy(id, value) {
    var el = document.getElementById(id);
    if (el) el.setAttribute('data-copy', value);
  }

  fill('co-order-id', order.id);
  fill('co-amount-ton', S.ton(amountTon));
  fill('co-amount-rub', S.rub(order.totalRub));
  fill('co-address', window.TONPAY.address);
  fill('co-comment', order.id);
  fill('co-nickname', order.nickname);
  fill('co-playerid', order.playerId);
  fill('co-contact', order.contact);
  fill('co-rate', '1 TON ≈ ' + S.rub(order.rate));

  setCopy('co-copy-address', window.TONPAY.address);
  setCopy('co-copy-amount', String(amountTon));
  setCopy('co-copy-comment', order.id);

  var itemsBox = document.getElementById('co-items');
  if (itemsBox) {
    itemsBox.innerHTML = order.items.map(function (i) {
      return '<div class="summary-row"><span>' + S.esc(i.title) +
        (i.qty > 1 ? ' × ' + i.qty : '') + '</span><span>' + S.rub(i.price * i.qty) + '</span></div>';
    }).join('');
  }

  ['co-pay-link', 'co-pay-tonkeeper', 'co-pay-tonhub'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    var scheme = id === 'co-pay-tonkeeper' ? 'tonkeeper' : (id === 'co-pay-tonhub' ? 'tonhub' : '');
    el.href = window.TONPAY.payLink(amountTon, order.id, scheme);
  });

  var tgBtn = document.getElementById('co-telegram');
  if (tgBtn) {
    var text = 'Заказ ' + order.id + '\nНик: ' + order.nickname + '\nID: ' + order.playerId +
               '\nСумма: ' + amountTon + ' TON';
    tgBtn.href = CFG.contacts.telegram + '?text=' + encodeURIComponent(text);
  }

  /* --------------------------------- QR ---------------------------------- */

  function drawQR() {
    var box = document.getElementById('co-qr');
    if (!box) return;
    if (!window.QRCode || !window.QRCode.toCanvas) {
      box.innerHTML = '<span class="tiny" style="color:#555;text-align:center;padding:10px">' +
        'QR недоступен — используйте кнопку «Оплатить в кошельке» или скопируйте реквизиты</span>';
      return;
    }
    var canvas = document.createElement('canvas');
    box.innerHTML = '';
    box.appendChild(canvas);
    window.QRCode.toCanvas(canvas, payLink, {
      width: 178, margin: 1,
      color: { dark: '#101012', light: '#ffffff' }
    }, function (err) {
      if (err) box.innerHTML = '<span class="tiny" style="color:#555">Не удалось построить QR</span>';
    });
  }
  // библиотека грузится с CDN и может не доехать — ждём её, но недолго
  var qrTries = 0;
  (function waitQR() {
    if (window.QRCode || qrTries++ > 20) drawQR();
    else setTimeout(waitQR, 150);
  })();

  /* ------------------------------- статус -------------------------------- */

  var pill = document.getElementById('co-status');
  var hint = document.getElementById('co-status-hint');
  var paidBox = document.getElementById('co-paid');
  var payBox = document.getElementById('co-payblock');
  var checkBtn = document.getElementById('co-check');
  var timerEl = document.getElementById('co-timer');
  var pollTimer = null;
  var tickTimer = null;

  function setStatus(status, text) {
    if (pill) { pill.setAttribute('data-status', status); pill.textContent = text; }
  }

  function markPaid(result) {
    S.orders.update(order.id, {
      status: 'paid',
      paidAt: Date.now(),
      paidTon: result && result.paid,
      txHash: (result && result.tx && result.tx.hash) || ''
    });
    setStatus('paid', 'Оплата получена');
    if (hint) hint.textContent = 'Платёж найден в блокчейне. Заказ передан оператору.';
    if (paidBox) paidBox.hidden = false;
    if (payBox) payBox.hidden = true;
    if (pollTimer) clearInterval(pollTimer);
    if (tickTimer) clearInterval(tickTimer);
    S.toast('Оплата подтверждена', 'ok');
  }

  function check(manual) {
    if (checkBtn && manual) { checkBtn.disabled = true; checkBtn.textContent = 'Проверяем…'; }

    return window.TONPAY.checkPayment(order.id, amountTon, order.createdAt)
      .then(function (res) {
        if (res.status === 'paid') { markPaid(res); return; }

        if (res.status === 'underpaid') {
          setStatus('wait', 'Оплачено частично');
          if (hint) {
            hint.textContent = 'Пришло ' + S.ton(res.paid) + ' из ' + S.ton(amountTon) +
              '. Доотправьте ' + S.ton(res.need) + ' с тем же комментарием ' + order.id + '.';
          }
        } else if (manual && hint) {
          hint.textContent = 'Платёж пока не виден. Если вы только что отправили — подождите 1–2 минуты, ' +
            'сеть подтверждает перевод не мгновенно.';
        }
      })
      .catch(function (e) {
        if (manual && hint) {
          hint.textContent = 'Не удалось опросить блокчейн (' + e.message + '). ' +
            'Проверьте позже или напишите в поддержку — заказ не потеряется.';
        }
      })
      .then(function () {
        if (checkBtn && manual) { checkBtn.disabled = false; checkBtn.textContent = 'Я оплатил — проверить'; }
      });
  }

  if (checkBtn) checkBtn.addEventListener('click', function () { check(true); });

  function tick() {
    var left = order.createdAt + PAY_WINDOW_MIN * 60000 - Date.now();
    if (left <= 0) {
      if (timerEl) timerEl.textContent = 'Курс заказа истёк — пересоберите заказ, чтобы пересчитать сумму.';
      if (tickTimer) clearInterval(tickTimer);
      return;
    }
    var m = Math.floor(left / 60000), s = Math.floor(left % 60000 / 1000);
    if (timerEl) timerEl.textContent = 'Сумма зафиксирована по курсу ещё ' + m + ':' + (s < 10 ? '0' : '') + s;
  }

  if (order.status === 'paid' || order.status === 'done') {
    markPaid({ paid: order.paidTon, tx: { hash: order.txHash } });
  } else {
    setStatus('wait', 'Ожидаем оплату');
    tick();
    tickTimer = setInterval(tick, 1000);
    pollTimer = setInterval(function () { check(false); }, POLL_MS);
    setTimeout(function () { check(false); }, 3000);
    // не долбим API вечно
    setTimeout(function () { if (pollTimer) clearInterval(pollTimer); }, PAY_WINDOW_MIN * 60000);
  }
})();
