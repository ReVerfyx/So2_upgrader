/* =========================================================================
   sell.js — заявка на выкуп скинов/голды. Формирует текст и открывает
   Telegram оператора с готовым сообщением (плюс кнопка «скопировать»).
   ========================================================================= */
(function () {
  'use strict';

  var S = window.SO2;
  var CFG = window.SITE_CONFIG || {};
  var form = document.getElementById('sell-form');
  if (!form) return;

  var out = document.getElementById('sell-result');
  var pre = document.getElementById('sell-text');
  var tg = document.getElementById('sell-telegram');
  var copyBtn = document.getElementById('sell-copy');

  function buildText(d) {
    return [
      'Заявка на продажу — ' + (CFG.brand || 'SO2'),
      'Что продаю: ' + d.what,
      'Описание: ' + d.details,
      'Желаемая сумма: ' + (d.price ? d.price + ' ₽' : 'на ваше усмотрение'),
      'Ник в игре: ' + d.nickname,
      'ID игрока: ' + d.playerId,
      'Кошелёк TON для выплаты: ' + d.wallet,
      'Связь: ' + d.contact
    ].join('\n');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var d = {
      what: form.elements.what.value,
      details: form.elements.details.value.trim(),
      price: form.elements.price.value.trim(),
      nickname: form.elements.nickname.value.trim(),
      playerId: form.elements.playerId.value.replace(/\s/g, ''),
      wallet: form.elements.wallet.value.trim(),
      contact: form.elements.contact.value.trim()
    };

    if (!d.details || d.details.length < 5) { S.toast('Опишите предметы подробнее', 'err'); return; }
    if (!d.nickname || !d.contact) { S.toast('Заполните ник и контакт для связи', 'err'); return; }
    if (d.wallet && !/^[A-Za-z0-9_-]{48}$/.test(d.wallet)) {
      S.toast('Адрес TON выглядит некорректно — проверьте', 'err');
      return;
    }

    var text = buildText(d);
    if (pre) pre.textContent = text;
    if (tg) tg.href = CFG.contacts.telegram + '?text=' + encodeURIComponent(text);
    if (copyBtn) copyBtn.setAttribute('data-copy', text);
    if (out) { out.hidden = false; out.scrollIntoView({ behavior: 'smooth', block: 'center' }); }

    S.profile.save(Object.assign(S.profile.read(), {
      nickname: d.nickname, playerId: d.playerId, contact: d.contact
    }));
  });

  var saved = S.profile.read();
  ['nickname', 'playerId', 'contact'].forEach(function (n) {
    if (saved[n] && form.elements[n]) form.elements[n].value = saved[n];
  });
})();
