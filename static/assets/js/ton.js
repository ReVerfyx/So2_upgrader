/* =========================================================================
   ton.js — проверка входящего платежа без бэкенда.

   Логика: читаем последние входящие транзакции кошелька через публичные
   API (tonapi -> toncenter, по очереди) и ищем перевод, у которого
   текстовый комментарий совпадает с номером заказа, а сумма не меньше
   ожидаемой (с допуском на курсовые копейки).
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.SITE_CONFIG || {};
  var ADDR = (CFG.ton && CFG.ton.address) || '';
  var ENDPOINTS = (CFG.ton && CFG.ton.api) || [];
  var TOLERANCE = (CFG.money && CFG.money.tolerance) || 0.02;
  var NANO = 1e9;

  function normComment(s) {
    return String(s || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  /* ---- нормализация ответов разных API к одному виду ---- */

  function fromTonapi(json) {
    var list = (json && (json.transactions || json.items)) || [];
    return list.map(function (tx) {
      var m = tx.in_msg || {};
      var body = m.decoded_body || {};
      var comment = body.text || body.comment || m.comment || '';
      return {
        comment: comment,
        ton: Number(m.value || 0) / NANO,
        time: Number(tx.utime || tx.now || 0) * 1000,
        hash: tx.hash || tx.transaction_id || '',
        from: (m.source && (m.source.address || m.source)) || ''
      };
    }).filter(function (t) { return t.ton > 0; });
  }

  function fromToncenter(json) {
    var list = (json && json.result) || [];
    return list.map(function (tx) {
      var m = tx.in_msg || {};
      return {
        comment: m.message || (m.msg_data && m.msg_data.text) || '',
        ton: Number(m.value || 0) / NANO,
        time: Number(tx.utime || 0) * 1000,
        hash: (tx.transaction_id && tx.transaction_id.hash) || '',
        from: m.source || ''
      };
    }).filter(function (t) { return t.ton > 0; });
  }

  var PARSERS = { tonapi: fromTonapi, toncenter: fromToncenter };

  /** Тянет транзакции с первого живого эндпоинта. */
  function fetchTxs() {
    if (!ADDR || !ENDPOINTS.length) return Promise.reject(new Error('TON-адрес не настроен'));

    var i = 0;
    function attempt() {
      if (i >= ENDPOINTS.length) return Promise.reject(new Error('Сервисы TON недоступны'));
      var ep = ENDPOINTS[i++];
      var url = String(ep.url).replace('{addr}', encodeURIComponent(ADDR));
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;

      return fetch(url, {
        headers: { Accept: 'application/json' },
        signal: ctrl ? ctrl.signal : undefined
      })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)); })
        .then(function (json) {
          if (timer) clearTimeout(timer);
          var parse = PARSERS[ep.type];
          if (!parse) throw new Error('неизвестный тип API: ' + ep.type);
          return parse(json);
        })
        .catch(function () { if (timer) clearTimeout(timer); return attempt(); });
    }
    return attempt();
  }

  /**
   * Ищет оплату заказа.
   * @param {string} orderId   номер заказа = комментарий к переводу
   * @param {number} expectTon ожидаемая сумма в TON
   * @param {number} sinceMs   не смотреть переводы старше момента создания заказа
   * @returns {Promise<{status:'paid'|'underpaid'|'none', tx?:object, need?:number}>}
   */
  function checkPayment(orderId, expectTon, sinceMs) {
    var want = normComment(orderId);
    var minTon = Number(expectTon) * (1 - TOLERANCE);
    var from = Number(sinceMs || 0) - 15 * 60 * 1000; // запас на расхождение часов

    return fetchTxs().then(function (txs) {
      var matched = txs.filter(function (t) {
        return normComment(t.comment) === want && (!t.time || t.time >= from);
      });
      if (!matched.length) return { status: 'none' };

      var sum = matched.reduce(function (s, t) { return s + t.ton; }, 0);
      var best = matched[0];

      if (sum + 1e-9 >= minTon) return { status: 'paid', tx: best, paid: sum };
      return { status: 'underpaid', tx: best, paid: sum, need: Number(expectTon) - sum };
    });
  }

  /** Ссылка для кошелька: ton://transfer/<адрес>?amount=<нанотоны>&text=<комментарий> */
  function payLink(amountTon, comment, scheme) {
    var nano = Math.ceil(Number(amountTon) * NANO);
    var q = 'amount=' + nano + '&text=' + encodeURIComponent(comment);
    if (scheme === 'tonkeeper') return 'https://app.tonkeeper.com/transfer/' + ADDR + '?' + q;
    if (scheme === 'tonhub') return 'https://tonhub.com/transfer/' + ADDR + '?' + q;
    return 'ton://transfer/' + ADDR + '?' + q;
  }

  window.TONPAY = {
    address: ADDR,
    checkPayment: checkPayment,
    fetchTxs: fetchTxs,
    payLink: payLink
  };
})();
