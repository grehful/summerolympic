/*
 * 모든 종목이 같이 쓰는 플레이어 설정 화면.
 *
 *   SO.setupPlayers(container, {
 *     title: '멀리뛰기',
 *     storageKey: 'longjump',         // 이름/설정 기억용
 *     maxPlayers: 8,
 *     attemptChoices: [1, 3, 6],      // 생략하면 시도 횟수 선택 안 보임
 *     defaultAttempts: 3,
 *   }, function onStart(config) { ... });
 *
 * config = { players: [{ name, color }], attempts }
 */
(function () {
  var SO = (window.SO = window.SO || {});

  SO.PLAYER_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#14b8a6', '#ec4899'];

  function load(key) {
    try { return JSON.parse(localStorage.getItem('so:' + key) || 'null'); } catch (e) { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem('so:' + key, JSON.stringify(value)); } catch (e) { /* 저장 불가 환경 무시 */ }
  }

  SO.setupPlayers = function (container, opts, onStart) {
    var max = opts.maxPlayers || 8;
    var saved = load(opts.storageKey + ':setup') || {};
    var count = Math.min(max, Math.max(1, saved.count || 1));
    var names = saved.names || [];
    var attempts = saved.attempts || opts.defaultAttempts || 1;
    if (opts.attemptChoices && opts.attemptChoices.indexOf(attempts) < 0) attempts = opts.defaultAttempts;

    container.innerHTML =
      '<div class="setup">' +
      '  <h1 class="setup-title">' + opts.title + '</h1>' +
      '  <p class="setup-sub muted">몇 명이서 할까요?</p>' +
      '  <div class="card">' +
      '    <div class="stepper">' +
      '      <button type="button" data-act="minus" aria-label="한 명 빼기">−</button>' +
      '      <div class="value" data-ref="count"></div>' +
      '      <button type="button" data-act="plus" aria-label="한 명 더하기">+</button>' +
      '    </div>' +
      '  </div>' +
      (opts.attemptChoices
        ? '  <div class="card"><h3>1인당 시도 횟수</h3><div class="seg" data-ref="attempts"></div></div>'
        : '') +
      '  <div class="card"><h3>선수 이름</h3><div class="name-list" data-ref="names"></div></div>' +
      '  <button type="button" class="btn btn-primary btn-block" data-act="start">경기 시작!</button>' +
      (opts.backHref ? '  <a class="btn btn-ghost btn-block" href="' + opts.backHref + '">종목 선택으로</a>' : '') +
      '</div>';

    var $ = function (sel) { return container.querySelector(sel); };
    var countEl = $('[data-ref=count]');
    var namesEl = $('[data-ref=names]');
    var attemptsEl = $('[data-ref=attempts]');

    function syncNames() {
      // 입력 중인 이름을 보존
      namesEl.querySelectorAll('input').forEach(function (inp, i) { names[i] = inp.value; });
    }

    function render() {
      countEl.textContent = count;
      $('[data-act=minus]').disabled = count <= 1;
      $('[data-act=plus]').disabled = count >= max;
      var html = '';
      for (var i = 0; i < count; i++) {
        html +=
          '<label class="name-row">' +
          '<span class="dot" style="background:' + SO.PLAYER_COLORS[i % SO.PLAYER_COLORS.length] + '"></span>' +
          '<input type="text" maxlength="10" enterkeyhint="done" placeholder="플레이어 ' + (i + 1) + '" value="' +
          (names[i] || '').replace(/"/g, '&quot;') + '">' +
          '</label>';
      }
      namesEl.innerHTML = html;
      if (attemptsEl) {
        attemptsEl.innerHTML = opts.attemptChoices.map(function (n) {
          return '<button type="button" data-attempts="' + n + '" aria-pressed="' + (n === attempts) + '">' + n + '번</button>';
        }).join('');
      }
    }

    container.onclick = function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.act === 'minus' && count > 1) { syncNames(); count--; render(); }
      else if (t.dataset.act === 'plus' && count < max) { syncNames(); count++; render(); }
      else if (t.dataset.attempts) { syncNames(); attempts = +t.dataset.attempts; render(); }
      else if (t.dataset.act === 'start') {
        syncNames();
        save(opts.storageKey + ':setup', { count: count, names: names, attempts: attempts });
        var players = [];
        for (var i = 0; i < count; i++) {
          players.push({
            name: (names[i] || '').trim() || '플레이어 ' + (i + 1),
            color: SO.PLAYER_COLORS[i % SO.PLAYER_COLORS.length],
          });
        }
        onStart({ players: players, attempts: attempts });
      }
    };

    render();
  };
})();
