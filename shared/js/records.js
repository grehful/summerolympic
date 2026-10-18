/*
 * 종목별·선수별 최고 기록 (이 기기에 저장, localStorage 'so:records').
 *
 *   var news = SO.records.save('long-jump', [{ name: '철수', value: 8.12 }, ...]);  // 경기 끝날 때
 *   SO.records.showNews(ui.final, news);   // 최종 결과 화면에 "새 기록" 안내
 *
 * 선수 이름이 같으면 같은 선수로 본다 (올림픽 모드의 국기는 떼고 저장).
 */
(function () {
  var SO = (window.SO = window.SO || {});
  var KEY = 'so:records';

  var m2 = function (v) { return v.toFixed(2) + ' m'; };
  var pts = function (v) { return v.toFixed(2) + '점'; };
  // 종목별 기록 표시 방법, lower: 낮을수록 좋은 기록
  var EVENTS = {
    'sprint-100m': { fmt: function (v) { return v.toFixed(2) + '초'; }, lower: true },
    'long-jump': { fmt: m2 },
    'triple-jump': { fmt: m2 },
    'high-jump': { fmt: function (v) { return (v / 100).toFixed(2) + ' m'; } },
    'shot-put': { fmt: m2 },
    'javelin': { fmt: m2 },
    'weightlifting': { fmt: function (v) { return v + ' kg'; } },
    'archery': { fmt: function (v) { return v + '점'; } },
    'trampoline': { fmt: pts },
    'rhythmic': { fmt: pts },
    'high-bar': { fmt: pts },
    'beam': { fmt: pts },
  };

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function store(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* 저장 불가 환경 무시 */ }
  }
  function cleanName(n) {
    // 올림픽 모드 이름 앞의 국기(지역 표시 문자 2개) 제거
    return String(n).replace(/^(?:\uD83C[\uDDE6-\uDDFF]){2}\s*/, '').trim();
  }
  function better(id, a, b) { return EVENTS[id] && EVENTS[id].lower ? a < b : a > b; }
  function today() {
    var d = new Date();
    return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate();
  }

  SO.records = {
    EVENTS: EVENTS,
    load: load,
    format: function (id, v) { return EVENTS[id] ? EVENTS[id].fmt(v) : String(v); },
    better: better,

    // 경기 결과 반영 → 새 기록 목록 [{ name, value, top }] (top = 종목 1위 기록)
    save: function (id, list, note) {
      var db = load();
      var ev = db[id] || (db[id] = {});
      var news = [];
      list.forEach(function (r) {
        if (r.value == null || !isFinite(r.value)) return;
        var name = cleanName(r.name);
        if (!name) return;
        var cur = ev[name];
        if (!cur || better(id, r.value, cur.v)) {
          ev[name] = { v: r.value, d: today(), n: note || '' };
          news.push({ name: name, value: r.value });
        }
      });
      // 종목 최고 기록인지 표시
      var ranked = this.ranking(id, db);
      news.forEach(function (n) { n.top = ranked.length > 0 && ranked[0].name === n.name; });
      store(db);
      return news;
    },

    // 종목 순위 [{ name, v, d, n, rank }]
    ranking: function (id, db) {
      db = db || load();
      var ev = db[id] || {};
      var list = Object.keys(ev).map(function (name) { return { name: name, v: ev[name].v, d: ev[name].d, n: ev[name].n }; });
      list.sort(function (a, b) { return better(id, a.v, b.v) ? -1 : better(id, b.v, a.v) ? 1 : 0; });
      var rank = 0;
      list.forEach(function (r, i) { if (i === 0 || list[i - 1].v !== r.v) rank = i + 1; r.rank = rank; });
      return list;
    },

    players: function () {
      var db = load(), names = {};
      Object.keys(db).forEach(function (id) { Object.keys(db[id]).forEach(function (n) { names[n] = 1; }); });
      return Object.keys(names).sort();
    },

    clear: function () { try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ } },

    // 최종 결과 화면에 새 기록 안내 붙이기
    showNews: function (finalEl, id, news) {
      var setup = finalEl.querySelector('.setup');
      var old = setup.querySelector('.record-news');
      if (old) old.remove();
      if (!news.length) return;
      var box = document.createElement('div');
      box.className = 'card record-news';
      box.innerHTML = '<h3>🎉 새 기록</h3>' + news.map(function (n) {
        var esc = String(n.name).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
        return '<div class="record-row"><span>' + esc + '</span><b>' + SO.records.format(id, n.value) + '</b>' +
          (n.top ? '<span class="record-top">종목 최고!</span>' : '<span class="record-pb">개인 최고</span>') + '</div>';
      }).join('');
      var table = setup.querySelector('.card');
      table.parentNode.insertBefore(box, table.nextSibling);
    },
  };
})();
