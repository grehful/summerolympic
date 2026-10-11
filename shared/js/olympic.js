/*
 * 올림픽 모드 공통 기능. 각 종목 페이지는 주소에 ?olympic 이 붙어 열리면 올림픽 모드로 동작한다.
 *
 *   if (SO.olympic.active()) SO.olympic.start('long-jump', startMatch); else startSetup();
 *   var k = SO.olympic.k('long-jump', playerIndex);   // 0(★1, 보너스 없음) ~ 1(★5, 최대 보너스)
 *   ui.introTurn.textContent += SO.olympic.introNote('long-jump', playerIndex);
 *   SO.olympic.onFinal('long-jump', [{ idx, rank, valid }], ui);  // 최종 결과 화면 → 시상식 버튼
 *
 * 진행 상황은 localStorage 'so:olympic' 에 저장된다.
 */
(function () {
  var SO = (window.SO = window.SO || {});
  var KEY = 'so:olympic';

  // 종목 정보: 올림픽 모드에서 쓰는 시도 횟수와 나라 보너스 설명
  var EVENTS = {
    'sprint-100m': { name: '100m 달리기', icon: '⏱️', attempts: 1, perk: '더 빨리 달리고 덜 지쳐요' },
    'long-jump': { name: '멀리뛰기', icon: '🏃', attempts: 3, perk: '더 빨리 달리고 더 멀리 튀어요' },
    'triple-jump': { name: '3단 뛰기', icon: '🦘', attempts: 3, perk: '더 빨리 달리고 리듬 판정이 넉넉해요' },
    'high-jump': { name: '높이뛰기', icon: '🤸', attempts: 150, perk: '더 높이 뛰고 적정 속도 폭이 넓어요' },
    'shot-put': { name: '투포환', icon: '💪', attempts: 3, perk: '던지는 힘이 세요' },
    'javelin': { name: '창던지기', icon: '🎯', attempts: 3, perk: '달리기와 팔 힘이 세요' },
    'weightlifting': { name: '역도', icon: '🏋️', attempts: 3, perk: '바늘이 느리고 구간이 넓고 덜 흔들려요' },
    'archery': { name: '양궁', icon: '🏹', attempts: 2, perk: '조준점이 덜 흔들려요' },
    'trampoline': { name: '트램폴린', icon: '🤸‍♀️', attempts: 1, perk: '타이밍·착지 판정이 넉넉해요' },
  };
  var ORDER = ['sprint-100m', 'long-jump', 'shot-put', 'archery', 'high-jump', 'javelin', 'weightlifting', 'triple-jump', 'trampoline'];

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function save(sess) {
    try { localStorage.setItem(KEY, JSON.stringify(sess)); } catch (e) { /* 무시 */ }
  }

  var activeFlag = /[?&]olympic\b/.test(location.search);

  SO.olympic = {
    EVENTS: EVENTS,
    ORDER: ORDER,
    load: load,
    save: save,
    clear: function () { try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ } },

    active: function () { return activeFlag && !!load(); },

    country: function (idx) {
      var sess = load();
      return sess && sess.players[idx] ? SO.countryById(sess.players[idx].country) : null;
    },
    rating: function (eventId, idx) {
      var c = this.active() ? this.country(idx) : null;
      return c ? c.ratings[eventId] || 1 : 1;
    },
    // 보너스 크기: ★1 → 0, ★5 → 1
    k: function (eventId, idx) { return (this.rating(eventId, idx) - 1) / 4; },
    stars: function (r) { return '★★★★★'.slice(0, r) + '☆☆☆☆☆'.slice(0, 5 - r); },

    // 올림픽 모드 선수 목록 (국기 + 이름)
    players: function () {
      var sess = load();
      return sess.players.map(function (p) {
        var c = SO.countryById(p.country);
        return { name: c.flag + ' ' + p.name, color: p.color, country: c };
      });
    },

    // 확인 창 없이 바로 올림픽을 끝내고 메인 화면으로 (앱 WebView 에서는 confirm() 이 안 뜬다)
    quit: function (homeHref) {
      this.clear();
      location.href = homeHref || '../../';
    },
    quitButton: function () {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost btn-block olympic-quit';
      btn.textContent = '🏁 올림픽 끝내기';
      btn.addEventListener('click', function () { SO.olympic.quit('../../'); });
      return btn;
    },

    // 설정 화면 없이 바로 경기 시작 (선수·나라는 올림픽 진행 정보에서)
    start: function (eventId, startMatch) {
      // 경기 중에도 매 차례 안내 화면에서 끝낼 수 있게
      var go = document.getElementById('introGo');
      if (go && !go.parentNode.querySelector('.olympic-quit')) {
        var q = this.quitButton();
        q.style.marginTop = '8px';
        go.parentNode.insertBefore(q, go.nextSibling);
      }
      startMatch(this.players(), EVENTS[eventId].attempts);
    },

    introNote: function (eventId, idx) {
      if (!this.active()) return '';
      var c = this.country(idx);
      var r = c.ratings[eventId] || 1;
      return '\n' + c.flag + ' ' + c.name + ' ' + this.stars(r) + (r > 1 ? ' — ' + EVENTS[eventId].perk : ' — 보너스 없음');
    },

    // 최종 결과 화면을 올림픽용으로 바꿈: 다시 하기 버튼들 대신 '시상식 & 다음 종목'
    onFinal: function (eventId, list, ui) {
      if (!this.active()) return;
      [ui.againBtn, ui.setupBtn].forEach(function (b) { if (b) b.classList.add('hidden'); });
      var setup = ui.final.querySelector('.setup');
      var back = setup.querySelector('a.btn');
      if (back) back.classList.add('hidden');
      setup.querySelectorAll('.olympic-next, .olympic-quit').forEach(function (b) { b.remove(); });
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary btn-block olympic-next';
      btn.textContent = '🏅 시상식 & 다음 종목';
      btn.addEventListener('click', function () { SO.olympic.finishEvent(eventId, list); });
      setup.appendChild(btn);
      setup.appendChild(this.quitButton());
    },

    finishEvent: function (eventId, list) {
      var sess = load();
      if (sess) {
        sess.results = sess.results || {};
        sess.results[eventId] = list;
        sess.justFinished = eventId;
        save(sess);
      }
      location.href = '../../olympic/';
    },

    // 순위 → 메달 (기록이 있는 선수만, 같은 순위는 같은 메달)
    medalsOf: function (list) {
      return list.map(function (r) {
        var m = r.valid && r.rank <= 3 ? ['gold', 'silver', 'bronze'][r.rank - 1] : null;
        return { idx: r.idx, rank: r.rank, valid: r.valid, medal: m };
      });
    },
  };
})();
