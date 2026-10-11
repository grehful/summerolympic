/*
 * 올림픽 모드 진행 화면.
 * 선수 수·종목 수 → 선수마다 나라 고르기 → (일정·메달 순위 ↔ 각 종목 경기 ↔ 시상식) → 폐회식
 * 경기 결과는 각 종목 페이지가 SO.olympic.finishEvent() 로 저장하고 이 페이지로 돌아온다.
 */
(function () {
  'use strict';

  var O = SO.olympic;
  var EV = O.EVENTS;
  var $ = function (id) { return document.getElementById(id); };
  var screens = ['setup', 'pick', 'board', 'ceremony', 'closing'];

  function showScreen(id) {
    screens.forEach(function (s) { $(s).classList.toggle('hidden', s !== id); });
    $(id).scrollTop = 0;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function starsHtml(r) {
    return '<span class="stars">' + '★★★★★'.slice(0, r) + '<span class="off">' + '★★★★★'.slice(0, 5 - r) + '</span></span>';
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // 나라가 잘하는 종목 아이콘 (★4 이상, 많으면 상위 3개)
  function strengths(c) {
    return O.ORDER.filter(function (e) { return c.ratings[e] >= 4; })
      .sort(function (a, b) { return c.ratings[b] - c.ratings[a]; })
      .slice(0, 3);
  }
  function fanfare() {
    [523, 659, 784, 1047].forEach(function (f, i) {
      setTimeout(function () { SO.sound.beep(f, i === 3 ? 0.5 : 0.18, 'triangle', 0.18); }, i * 160);
    });
  }

  // ---- 1. 선수 수·종목 수 ----
  function startSetup() {
    showScreen('setup');
    SO.setupPlayers($('setup'), {
      title: '🏅 올림픽 모드',
      storageKey: 'olympic',
      maxPlayers: 8,
      attemptChoices: [3, 5, 9],
      defaultAttempts: 5,
      attemptLabel: '종목 수',
      attemptUnit: '종목',
      backHref: '../',
    }, function (cfg) {
      SO.sound.unlock();
      // 종목은 무작위로 고르되 순서는 기본 일정(100m → … → 트램폴린)을 따른다
      var picked = cfg.attempts >= O.ORDER.length ? O.ORDER.slice() : shuffle(O.ORDER.slice()).slice(0, cfg.attempts);
      var events = O.ORDER.filter(function (e) { return picked.indexOf(e) >= 0; });
      startPick(cfg.players, events);
    });
    var start = $('setup').querySelector('[data-act=start]');
    if (start) start.textContent = '나라 고르기 →';
  }

  // ---- 2. 나라 고르기 ----
  var pick = null; // { players, events, i, sel }

  function startPick(players, events) {
    pick = { players: players, events: events, i: 0, sel: null };
    players.forEach(function (p) { delete p.country; });
    showScreen('pick');
    renderPick();
  }

  function renderPick() {
    var p = pick.players[pick.i];
    var taken = {};
    pick.players.forEach(function (q, j) { if (j !== pick.i && q.country) taken[q.country] = q.name; });
    pick.sel = p.country || null;
    $('pickTitle').innerHTML = '<span class="dot-inline" style="color:' + p.color + '">●</span> ' + esc(p.name) + '의 나라';
    $('countryGrid').innerHTML = SO.COUNTRIES.map(function (c) {
      var t = taken[c.id];
      return '<button type="button" class="country" data-id="' + c.id + '" aria-pressed="' + (pick.sel === c.id) + '"' + (t ? ' disabled' : '') + '>' +
        '<span class="flag">' + c.flag + '</span><span class="cname">' + c.name + '</span>' +
        (t ? '<span class="taken">' + esc(t) + '</span>'
           : '<span class="best">' + strengths(c).map(function (e) { return EV[e].icon; }).join('') + '</span>') +
        '</button>';
    }).join('');
    $('pickBack').textContent = pick.i === 0 ? '← 다시 설정' : '← 이전 선수';
    $('pickOk').textContent = pick.i === pick.players.length - 1 ? '이 나라로! 개막식 →' : '이 나라로!';
    renderDetail();
  }

  function renderDetail() {
    var c = pick.sel && SO.countryById(pick.sel);
    $('pickOk').disabled = !c;
    $('pickDetail').classList.toggle('hidden', !c);
    if (!c) return;
    $('pickDetail').innerHTML =
      '<div class="head"><span class="flag">' + c.flag + '</span>' + c.name + '</div>' +
      '<div class="rating-list">' + O.ORDER.map(function (e) {
        var mark = pick.events.indexOf(e) >= 0 ? '' : ' style="opacity:.4"';
        return '<div class="r"' + mark + '><span>' + EV[e].icon + ' ' + EV[e].name + '</span>' + starsHtml(c.ratings[e]) + '</div>';
      }).join('') + '</div>';
  }

  $('countryGrid').addEventListener('click', function (e) {
    var b = e.target.closest('.country');
    if (!b || b.disabled) return;
    pick.sel = b.dataset.id;
    $('countryGrid').querySelectorAll('.country').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    SO.sound.beep(660, 0.06, 'square', 0.08);
    renderDetail();
  });
  $('pickRandom').addEventListener('click', function () {
    var free = [].filter.call($('countryGrid').querySelectorAll('.country'), function (b) { return !b.disabled; });
    var b = free[Math.floor(Math.random() * free.length)];
    if (b) b.click();
    if (b) b.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  $('pickOk').addEventListener('click', function () {
    if (!pick.sel) return;
    pick.players[pick.i].country = pick.sel;
    if (pick.i < pick.players.length - 1) { pick.i++; renderPick(); $('pick').scrollTop = 0; return; }
    O.save({ players: pick.players, events: pick.events, results: {} });
    fanfare();
    renderBoard();
  });
  $('pickBack').addEventListener('click', function () {
    if (pick.i === 0) { startSetup(); return; }
    pick.i--;
    renderPick();
  });

  // ---- 메달 집계 ----
  function standings(sess) {
    var n = sess.players.length;
    var rows = sess.players.map(function (p, i) {
      return { idx: i, p: p, c: SO.countryById(p.country), gold: 0, silver: 0, bronze: 0, pts: 0 };
    });
    sess.events.forEach(function (e) {
      var res = sess.results[e];
      if (!res) return;
      O.medalsOf(res).forEach(function (m) {
        var r = rows[m.idx];
        if (!r) return;
        if (m.medal) r[m.medal]++;
        if (m.valid) r.pts += n - m.rank + 1; // 동점일 때 순위 점수로 가름
      });
    });
    rows.sort(function (a, b) {
      return b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || b.pts - a.pts;
    });
    rows.forEach(function (r, i) {
      var prev = rows[i - 1];
      r.rank = prev && prev.gold === r.gold && prev.silver === r.silver && prev.bronze === r.bronze && prev.pts === r.pts ? prev.rank : i + 1;
    });
    return rows;
  }

  function medalTableHtml(sess) {
    return '<tr><th></th><th>선수</th><th class="m">🥇</th><th class="m">🥈</th><th class="m">🥉</th></tr>' +
      standings(sess).map(function (r) {
        return '<tr><td class="rank">' + r.rank + '</td>' +
          '<td class="pname"><span class="dot" style="background:' + r.p.color + '"></span>' + r.c.flag + ' ' + esc(r.p.name) + '</td>' +
          '<td class="m">' + r.gold + '</td><td class="m">' + r.silver + '</td><td class="m">' + r.bronze + '</td></tr>';
      }).join('');
  }

  function nextEvent(sess) {
    for (var i = 0; i < sess.events.length; i++) if (!sess.results[sess.events[i]]) return sess.events[i];
    return null;
  }

  // ---- 3. 일정 & 메달 순위 ----
  function renderBoard() {
    var sess = O.load();
    var next = nextEvent(sess);
    if (!next) { renderClosing(); return; }
    showScreen('board');
    var no = sess.events.indexOf(next) + 1;
    $('nextCard').innerHTML =
      '<div class="label">' + no + ' / ' + sess.events.length + ' 종목</div>' +
      '<div class="ev"><span class="icon">' + EV[next].icon + '</span>' + EV[next].name + '</div>' +
      '<div class="who">' + sess.players.map(function (p) {
        var c = SO.countryById(p.country);
        return '<div class="r"><span>' + c.flag + ' ' + esc(p.name) + '</span>' + starsHtml(c.ratings[next]) + '</div>';
      }).join('') + '</div>' +
      '<a class="btn btn-primary btn-block" id="goBtn" href="../games/' + next + '/?olympic=1">▶ 경기 시작</a>';
    $('medalTable').innerHTML = medalTableHtml(sess);
    $('schedule').innerHTML = sess.events.map(function (e) {
      var res = sess.results[e];
      var winner = '';
      if (res) {
        var golds = res.filter(function (r) { return r.valid && r.rank === 1; });
        winner = golds.length
          ? '🥇 ' + golds.map(function (r) { var p = sess.players[r.idx]; return SO.countryById(p.country).flag + ' ' + esc(p.name); }).join(', ')
          : '기록 없음';
      }
      return '<li class="' + (res ? 'done' : e === next ? 'now' : '') + '"><span class="icon">' + EV[e].icon + '</span>' +
        '<span class="nm">' + EV[e].name + '</span><span class="res">' + (res ? winner : e === next ? '다음 경기' : '') + '</span></li>';
    }).join('');
  }

  $('quitBtn').addEventListener('click', function () { O.quit('../'); });

  // ---- 4. 시상식 ----
  function renderCeremony(eventId) {
    var sess = O.load();
    var res = O.medalsOf(sess.results[eventId] || []).slice().sort(function (a, b) { return a.rank - b.rank; });
    showScreen('ceremony');
    $('cerTitle').textContent = EV[eventId].icon + ' ' + EV[eventId].name + ' 시상식';
    var label = function (m) {
      var p = sess.players[m.idx];
      return SO.countryById(p.country).flag + '<br>' + esc(p.name);
    };
    var byMedal = { gold: [], silver: [], bronze: [] };
    res.forEach(function (m) { if (m.medal) byMedal[m.medal].push(m); });
    var step = function (cls, medal, icon, num) {
      var list = byMedal[medal];
      if (!list.length) return '<div class="step ' + cls + '"></div>';
      return '<div class="step ' + cls + '"><div class="medal">' + icon + '</div>' +
        '<div class="who">' + list.map(label).join('<br>') + '</div><div class="block">' + num + '</div></div>';
    };
    $('podium').innerHTML = res.some(function (m) { return m.medal; })
      ? step('p2', 'silver', '🥈', 2) + step('p1', 'gold', '🥇', 1) + step('p3', 'bronze', '🥉', 3)
      : '<p class="muted">메달을 딴 선수가 없어요</p>';
    $('cerTable').innerHTML = res.map(function (m) {
      var p = sess.players[m.idx];
      var icon = m.medal ? { gold: '🥇', silver: '🥈', bronze: '🥉' }[m.medal] : m.valid ? m.rank : '–';
      return '<tr><td class="rank">' + icon + '</td><td>' + SO.countryById(p.country).flag + ' ' + esc(p.name) + '</td>' +
        '<td class="num">' + (m.valid ? m.rank + '위' : '기록 없음') + '</td></tr>';
    }).join('');
    $('cerOk').textContent = nextEvent(sess) ? '메달 순위 & 다음 종목' : '🎆 폐회식으로';
    fanfare();
    SO.vibrate([60, 60, 120]);
  }
  $('cerOk').addEventListener('click', renderBoard);

  // ---- 5. 폐회식 ----
  function renderClosing() {
    var sess = O.load();
    showScreen('closing');
    var rows = standings(sess);
    var top = rows.filter(function (r) { return r.rank === 1; });
    $('champion').innerHTML =
      '<div class="flag">' + top.map(function (r) { return r.c.flag; }).join(' ') + '</div>' +
      '<div class="title">종합 우승</div>' +
      '<div class="nm">' + top.map(function (r) { return esc(r.p.name); }).join(', ') + '</div>' +
      '<div class="muted">' + top.map(function (r) { return r.c.name; }).join(', ') +
      ' · 🥇' + top[0].gold + ' 🥈' + top[0].silver + ' 🥉' + top[0].bronze + '</div>';
    $('finalMedals').innerHTML = medalTableHtml(sess);
  }
  $('newBtn').addEventListener('click', function () { O.clear(); startSetup(); });

  // ---- 시작: 진행 중인 올림픽이 있으면 이어서 ----
  (function boot() {
    var sess = O.load();
    if (!sess || !sess.players || !sess.events) { startSetup(); return; }
    if (sess.justFinished) {
      var e = sess.justFinished;
      delete sess.justFinished;
      O.save(sess);
      renderCeremony(e);
      return;
    }
    renderBoard();
  })();

  // 디버그·테스트용
  window.Olympic = { standings: function () { return standings(O.load()); } };
})();
