/*
 * 기록실: 종목별 순위 / 선수별 최고 기록 (shared/js/records.js 의 저장 기록을 보여줌)
 */
(function () {
  'use strict';
  var R = SO.records;
  var $ = function (id) { return document.getElementById(id); };
  var TOP = 10;           // 종목별로 보여줄 순위 수
  var selected = null;    // 선수별 탭에서 고른 선수

  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function medal(r) { return r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : r; }
  // 올해 기록은 월.일만
  function shortDate(d) {
    var y = String(new Date().getFullYear()) + '.';
    return String(d || '').indexOf(y) === 0 ? String(d).slice(y.length) : d || '';
  }
  function games() { return SO.GAMES.filter(function (g) { return g.ready && R.EVENTS[g.id]; }); }

  function renderEvents() {
    var db = R.load();
    $('eventView').innerHTML = games().map(function (g) {
      var list = R.ranking(g.id, db);
      var rows = list.slice(0, TOP).map(function (r) {
        return '<tr><td class="rank">' + medal(r.rank) + '</td><td class="pname">' + esc(r.name) + '</td>' +
          '<td class="num">' + R.format(g.id, r.v) + (r.n ? ' <small class="muted">' + esc(r.n) + '</small>' : '') + '</td>' +
          '<td class="date">' + esc(shortDate(r.d)) + '</td></tr>';
      }).join('');
      if (list.length > TOP) rows += '<tr><td colspan="4" class="more">외 ' + (list.length - TOP) + '명</td></tr>';
      return '<div class="card ev-card"><h3><span class="icon">' + g.icon + '</span>' + g.name + '</h3>' +
        (rows ? '<table class="ranking">' + rows + '</table>' : '<div class="none">아직 기록 없음</div>') + '</div>';
    }).join('');
  }

  function renderPlayers() {
    var names = R.players();
    if (selected && names.indexOf(selected) < 0) selected = null;
    if (!selected && names.length) selected = names[0];
    $('playerChips').innerHTML = names.map(function (n) {
      return '<button type="button" data-name="' + esc(n) + '" aria-pressed="' + (n === selected) + '">' + esc(n) + '</button>';
    }).join('');
    var card = $('playerCard');
    card.classList.toggle('hidden', !selected);
    if (!selected) return;
    var db = R.load();
    var golds = 0, count = 0;
    var rows = games().map(function (g) {
      var list = R.ranking(g.id, db);
      var me = list.filter(function (r) { return r.name === selected; })[0];
      if (!me) return '<tr><td class="rank">' + g.icon + '</td><td class="pname">' + g.name + '</td><td class="num muted">-</td><td class="date"></td></tr>';
      count++;
      if (me.rank === 1) golds++;
      return '<tr><td class="rank">' + g.icon + '</td><td class="pname">' + g.name + '</td>' +
        '<td class="num">' + R.format(g.id, me.v) + '</td>' +
        '<td class="date">' + (me.rank === 1 ? '🥇 1위' : me.rank + '위') + ' / ' + list.length + '명</td></tr>';
    }).join('');
    card.innerHTML = '<div class="player-head">' + esc(selected) + '</div>' +
      '<div class="player-sum">기록 있는 종목 ' + count + '개 · 종목 1위 ' + golds + '개</div>' +
      '<table class="ranking">' + rows + '</table>';
  }

  function render() {
    var any = R.players().length > 0;
    $('empty').classList.toggle('hidden', any);
    $('clearBtn').classList.toggle('hidden', !any);
    renderEvents();
    renderPlayers();
  }

  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var tab = b.dataset.tab;
    $('tabs').querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    $('eventView').classList.toggle('hidden', tab !== 'event');
    $('playerView').classList.toggle('hidden', tab !== 'player');
  });
  $('playerChips').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    selected = b.dataset.name;
    renderPlayers();
  });

  // 지우기: 실수 방지로 두 번 눌러야 지워짐 (앱에서는 확인 창이 안 뜸)
  var armTimer = null;
  $('clearBtn').addEventListener('click', function () {
    var btn = $('clearBtn');
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.textContent = '한 번 더 누르면 모두 지워져요';
      clearTimeout(armTimer);
      armTimer = setTimeout(function () { btn.classList.remove('armed'); btn.textContent = '기록 모두 지우기'; }, 3000);
      return;
    }
    clearTimeout(armTimer);
    R.clear();
    btn.classList.remove('armed');
    btn.textContent = '기록 모두 지우기';
    render();
  });

  render();
  SO.registerSW('../sw.js');
})();
