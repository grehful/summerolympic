/*
 * 3단 뛰기 (홉 → 스텝 → 점프)
 *
 * 1. 달리기 버튼 연타로 속도 올리기 (멀리뛰기와 같음)
 * 2. 점프 구간에서 점프 버튼을 누르고 있으면 각도가 오르고, 떼면 첫 도약(홉). 발판 선을 넘으면 파울
 * 3. 공중에서 착지할 곳에 원이 줄어든다. 땅에 닿는 순간 점프 버튼을 누르면 '퍼펙트' →
 *    누르는 타이밍이 정확할수록 속도가 유지되고, 누르고 있는 동안 각도가 오르지만 속도가 조금씩 빠진다.
 *    떼면 다음 도약. 착지 후 0.35초 안에 안 누르면 리듬이 끊겨 파울
 * 4. 세 번째 점프는 모래판에 떨어져야 함. 기록 = 착지 지점 - 발판 선 (cm 아래 버림)
 */
(function () {
  'use strict';

  // ---- 튜닝 값 ----
  var LINE_X = 40;          // 출발점에서 발판 선까지 (m)
  var JUMP_ZONE = 12;       // 선 앞 몇 m부터 점프 버튼이 켜지는지
  var V_MAX = 18;
  var TAP_BOOST = 1.0;
  var DRAG = 0.4;
  var ANGLE_RATE = 60;      // 누르고 있을 때 초당 각도 증가 (°)
  var ANGLE_MAX = 60;
  var MIN_ANGLE = 6;        // 톡 치고 떼면 이 각도로 낮게 튐
  var SPRING = 1.22;        // 도약 반발
  var ANGLE_COST = 1.5;     // 각도가 높을수록 속도 손실 → 각 도약 최적 약 15~20°
  var CONTACT_LOSS = 0.3;   // 땅을 딛고 누르고 있는 동안 초당 속도 손실 비율
  var HOLD_MAX = 0.8;       // 이보다 오래 누르면 자동으로 도약
  var EARLY_MAX = 0.35;     // 착지 이만큼 전부터 눌러도 인정 (초)
  var LATE_MAX = 0.35;      // 착지 후 이만큼 안에 눌러야 함
  // 착지 타이밍 오차(초) → 속도 유지 비율
  var TIMING = [
    { lim: 0.06, keep: 0.97, label: '퍼펙트!', cls: 'perfect' },
    { lim: 0.12, keep: 0.92, label: '좋아요', cls: 'good' },
    { lim: 0.2, keep: 0.84, label: '아쉬워요', cls: 'ok' },
    { lim: 0.35, keep: 0.72, label: '', cls: 'late' },
  ];
  var LAND_REACH = 0.4;
  var PIT_START = 8;        // 모래판 시작 (선 기준 m)
  var PIT_END = 21;
  var WORLD_RECORD = 18.29;
  var G = 9.81;
  var SLOWMO = 0.55;        // 공중 장면 속도 (타이밍 맞추기 쉽게)
  var STRIDE = 2.2;
  var PHASE_NAMES = ['홉', '스텝', '점프'];

  var SO = window.SO;
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    setup: $('setup'), game: $('game'), final: $('final'),
    hudDot: $('hudDot'), hudName: $('hudName'), hudAttempt: $('hudAttempt'), hudBest: $('hudBest'),
    stage: $('stage'), canvas: $('canvas'),
    speed: $('speed'), angle: $('angle'), toLine: $('toLine'), banner: $('banner'),
    phases: $('phases'), timing: $('timing'),
    intro: $('intro'), introTurn: $('introTurn'), introName: $('introName'), introGo: $('introGo'),
    result: $('result'), resDist: $('resDist'), resBadge: $('resBadge'), resDetail: $('resDetail'),
    resTable: $('resTable'), resNext: $('resNext'),
    runBtn: $('runBtn'), jumpBtn: $('jumpBtn'),
    finalTable: $('finalTable'), againBtn: $('againBtn'), setupBtn: $('setupBtn'),
  };
  var ctx = ui.canvas.getContext('2d');

  // ---- 경기 진행 상태 ----
  var match = null;
  var s = null;

  function currentPlayer() { return match.players[match.turn % match.players.length]; }
  function currentRound() { return Math.floor(match.turn / match.players.length) + 1; }
  function totalTurns() { return match.players.length * match.attempts; }

  function newAttempt() {
    s = {
      phase: 'intro',     // intro → countdown → run → flight ⇄ contact → landed | foul → result
      x: 0, y: 0, v: 0, stride: 0,
      angle: 0, charging: false,
      hop: -1,            // 지금(또는 마지막) 도약 번호 0=홉 1=스텝 2=점프
      t: 0, lastTap: 0,
      x0: 0, vx: 0, vy: 0, flightT: 0, flightDur: 0,
      pressEarly: null,   // 착지 전에 누른 경우 남은 시간 (초)
      pressHeld: false,
      contactT: 0, pressedInContact: false, holdT: 0,
      keep: 1,            // 다음 도약에 적용할 속도 유지 비율
      takeoffs: [],       // [{x, v, angle}]
      landings: [],       // 착지 x
      timings: [],        // 타이밍 등급 라벨
      markX: null,
      result: null,
      cam: -4,
      shake: 0,
    };
  }

  // ---- 화면 전환 ----
  function show(el) {
    [ui.setup, ui.game, ui.final].forEach(function (x) { x.classList.toggle('hidden', x !== el); });
  }

  function startSetup() {
    show(ui.setup);
    SO.setupPlayers(ui.setup, {
      title: '🦘 3단 뛰기',
      storageKey: 'triplejump',
      maxPlayers: 8,
      attemptChoices: [1, 3, 6],
      defaultAttempts: 3,
      backHref: '../../',
    }, function (cfg) {
      SO.enterGameMode();
      startMatch(cfg.players, cfg.attempts);
    });
  }

  function startMatch(players, attempts) {
    match = {
      players: players.map(function (p) { return { name: p.name, color: p.color, marks: [] }; }),
      attempts: attempts,
      turn: 0,
    };
    show(ui.game);
    resize();
    beginTurn();
  }

  // ---- 올림픽 모드: 나라 실력(★)에 따른 보너스 (★1 = 보너스 없음) ----
  var BASE = { TAP_BOOST: TAP_BOOST, EARLY_MAX: EARLY_MAX, LATE_MAX: LATE_MAX, LIMS: TIMING.map(function (t) { return t.lim; }) };
  function applyBoost(idx) {
    var k = SO.olympic.k('triple-jump', idx);
    TAP_BOOST = BASE.TAP_BOOST * (1 + 0.08 * k);  // 더 빨리 달리고
    var widen = 1 + 0.4 * k;                       // 리듬 판정이 넉넉해짐
    TIMING.forEach(function (t, i) { t.lim = BASE.LIMS[i] * widen; });
    EARLY_MAX = BASE.EARLY_MAX * widen;
    LATE_MAX = BASE.LATE_MAX * widen;
  }

  function beginTurn() {
    applyBoost(match.turn % match.players.length);
    newAttempt();
    var p = currentPlayer();
    ui.hudDot.style.background = p.color;
    ui.hudName.textContent = p.name;
    ui.hudAttempt.textContent = currentRound() + '/' + match.attempts + '차 시기';
    var b = best(p);
    ui.hudBest.textContent = b == null ? '' : '최고 ' + fmtDist(b);
    ui.introTurn.textContent = currentRound() + '차 시기' + (match.players.length > 1 ? ' · ' + (match.turn % match.players.length + 1) + '번째 선수' : '');
    ui.introTurn.textContent += SO.olympic.introNote('triple-jump', match.turn % match.players.length);
    ui.introName.textContent = p.name;
    ui.introName.style.color = p.color;
    ui.result.classList.add('hidden');
    ui.intro.classList.remove('hidden');
    ui.timing.classList.add('hidden');
    hideBanner();
    updateHud();
  }

  ui.introGo.addEventListener('click', function () {
    SO.enterGameMode();
    ui.intro.classList.add('hidden');
    s.phase = 'countdown';
    s.t = 0;
    s.count = 4;
  });

  // ---- 입력 ----
  function tap() {
    if (s.phase !== 'run' || s.charging) return;
    s.v += TAP_BOOST * Math.max(0, 1 - s.v / V_MAX);
    s.lastTap = s.t;
    SO.sound.beep(160 + s.v * 14, 0.035, 'square', 0.05);
    SO.vibrate(8);
  }

  function inZone() { return s && s.phase === 'run' && LINE_X - s.x <= JUMP_ZONE; }

  function jumpDown() {
    if (s.phase === 'run') {
      if (s.charging) return;
      if (!inZone()) { shake(ui.jumpBtn); return; }
      s.charging = true;
      s.angle = 0;
      SO.vibrate(15);
    } else if (s.phase === 'flight' && s.hop < 2 && s.pressEarly == null) {
      // 착지 직전에 미리 누르기
      var remain = (s.flightDur - s.flightT) / SLOWMO;
      if (remain > EARLY_MAX) { showTiming('너무 빨라요', 'late'); return; }
      s.pressEarly = remain;
      s.pressHeld = true;
    } else if (s.phase === 'contact' && !s.pressedInContact && !s.charging) {
      // 착지 후 누르기 (늦을수록 손해)
      s.pressedInContact = true;
      judge(s.contactT, false);
      s.charging = true;
      s.angle = 0;
      s.holdT = 0;
    }
  }

  function jumpUp() {
    if (s.phase === 'run' && s.charging) {
      s.charging = false;
      takeoff(0);
    } else if (s.phase === 'flight' && s.pressHeld) {
      s.pressHeld = false; // 착지 전에 톡 치고 뗌 → 착지하자마자 낮게 튐
    } else if (s.phase === 'contact' && s.charging) {
      s.charging = false;
      takeoff(s.hop + 1);
    }
  }

  function shake(btn) {
    btn.classList.remove('shake');
    void btn.offsetWidth;
    btn.classList.add('shake');
  }

  function pressFx(btn) {
    btn.classList.add('pressed');
    clearTimeout(btn._t);
    btn._t = setTimeout(function () { btn.classList.remove('pressed'); }, 70);
  }

  ui.runBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); pressFx(ui.runBtn); tap(); });
  ui.jumpBtn.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    try { ui.jumpBtn.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    jumpDown();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) {
    ui.jumpBtn.addEventListener(ev, function () { jumpUp(); });
  });
  document.addEventListener('contextmenu', function (e) { if (!ui.game.classList.contains('hidden')) e.preventDefault(); });

  // 키보드 (PC 테스트용): 스페이스/→ = 달리기, ↑ = 점프
  document.addEventListener('keydown', function (e) {
    if (!match || ui.game.classList.contains('hidden') || e.repeat) return;
    if (e.code === 'Space' || e.code === 'ArrowRight') { e.preventDefault(); tap(); }
    if (e.code === 'ArrowUp') { e.preventDefault(); jumpDown(); }
  });
  document.addEventListener('keyup', function (e) { if (e.code === 'ArrowUp') jumpUp(); });

  // 타이밍 판정 (err: 착지와의 시간차, early: 착지 전에 눌렀는지)
  function judge(err, early) {
    var g = TIMING[TIMING.length - 1];
    for (var i = 0; i < TIMING.length; i++) { if (err <= TIMING[i].lim) { g = TIMING[i]; break; } }
    s.keep = g.keep;
    var label = g.label || (early ? '빨랐어요' : '늦었어요');
    if (g.cls === 'ok') label = early ? '조금 빨라요' : '조금 늦어요';
    s.timings.push(label);
    showTiming(label, g.cls);
    if (g.cls === 'perfect') { SO.sound.beep(1320, 0.08, 'sine', 0.18); SO.vibrate([15, 20, 15]); }
  }

  // ---- 물리 ----
  function takeoff(k) {
    var angle = Math.max(MIN_ANGLE, s.angle);
    if (k > 0) s.v *= s.keep;
    var a = angle * Math.PI / 180;
    var sin = Math.sin(a);
    var eff = Math.max(0.05, 1 - ANGLE_COST * sin * sin) * SPRING;
    s.angle = angle;
    s.hop = k;
    s.takeoffs.push({ x: s.x, v: s.v, angle: angle });
    s.x0 = s.x;
    s.vx = s.v * Math.cos(a) * eff;
    s.vy = s.v * sin * eff;
    s.flightDur = 2 * s.vy / G;
    s.flightT = 0;
    s.pressEarly = null;
    s.pressHeld = false;
    s.phase = 'flight';
    s.t = 0;
    SO.sound.sweep(300 + k * 120, 800 + k * 150, 0.25, 'triangle', 0.18);
    SO.vibrate(25);
    if (k === 0) showBanner(PHASE_NAMES[0] + '!', false);
  }

  function touchdown() {
    var lx = s.x0 + s.vx * s.flightDur;
    s.x = lx;
    s.y = 0;
    if (s.hop === 2) return finalLanding();
    s.landings.push(lx);
    s.phase = 'contact';
    s.contactT = 0;
    s.holdT = 0;
    s.pressedInContact = false;
    s.charging = false;
    SO.sound.noise(0.08, 0.35, 700); // 탁
    SO.vibrate(12);
    hideBanner();
    if (s.pressEarly != null) {
      s.pressedInContact = true;
      judge(s.pressEarly, true);
      if (s.pressHeld) { s.charging = true; s.angle = 0; }
      else { s.angle = MIN_ANGLE; takeoff(s.hop + 1); }
    }
  }

  function finalLanding() {
    s.markX = s.x0 + s.vx * s.flightDur + LAND_REACH;
    s.landings.push(s.markX);
    s.phase = 'landed';
    s.t = 0;
    s.shake = 0.25;
    SO.sound.noise(0.35, 0.5, 900);
    SO.vibrate([40, 30, 20]);
    var rel = s.markX - LINE_X;
    if (rel < PIT_START) {
      s.result = { dist: null, reason: '모래판에 못 미쳤어요' };
      showBanner('파울', true);
      SO.sound.beep(140, 0.5, 'sawtooth', 0.2);
    } else {
      var d = Math.floor(rel * 100 + 1e-6) / 100;
      s.result = { dist: d };
      showBanner(fmtDist(d), false);
      if (d >= 16) SO.sound.noise(1.6, 0.25, 2200);
    }
  }

  function foul(reason) {
    s.phase = 'foul';
    s.t = 0;
    s.charging = false;
    s.result = { dist: null, reason: reason };
    showBanner('파울!', true);
    SO.sound.beep(140, 0.6, 'sawtooth', 0.22);
    SO.vibrate([80, 40, 80]);
  }

  function update(dt) {
    s.t += dt;
    s.shake = Math.max(0, s.shake - dt);
    switch (s.phase) {
      case 'countdown': {
        var n = 3 - Math.floor(s.t / 0.7);
        if (n !== s.count) {
          s.count = n;
          if (n > 0) { showBanner(String(n), false); SO.sound.beep(520, 0.12, 'sine', 0.2); }
          else { showBanner('출발!', false); SO.sound.beep(880, 0.3, 'sine', 0.25); s.phase = 'run'; s.t = 0; s.lastTap = 0; }
        }
        break;
      }
      case 'run':
        if (s.t > 0.6 && ui.banner.textContent === '출발!') hideBanner();
        if (s.charging) s.angle = Math.min(ANGLE_MAX, s.angle + ANGLE_RATE * dt);
        s.v = Math.max(0, s.v - DRAG * s.v * dt);
        if (s.v < 0.15) s.v = 0;
        s.x += s.v * dt;
        s.stride += s.v * dt;
        if (s.x > LINE_X) foul('발이 선을 넘었어요');
        else if (s.v === 0 && s.t - s.lastTap > 4) foul('시간 초과');
        break;
      case 'flight': {
        s.flightT += dt * SLOWMO;
        var ft = Math.min(s.flightT, s.flightDur);
        s.x = s.x0 + s.vx * ft;
        s.y = s.vy * ft - 0.5 * G * ft * ft;
        if (s.t > 0.5 && s.hop === 0) hideBanner();
        if (s.flightT >= s.flightDur) touchdown();
        break;
      }
      case 'contact':
        s.contactT += dt;
        if (!s.pressedInContact && s.contactT > LATE_MAX) { foul('리듬이 끊겼어요 (' + PHASE_NAMES[s.hop + 1] + ' 타이밍 놓침)'); break; }
        if (s.charging) {
          s.holdT += dt;
          s.angle = Math.min(ANGLE_MAX, s.angle + ANGLE_RATE * dt);
          s.v *= 1 - CONTACT_LOSS * dt;
          if (s.holdT >= HOLD_MAX) { s.charging = false; takeoff(s.hop + 1); }
        }
        break;
      case 'landed': {
        var k = Math.min(1, s.t / 0.25);
        s.x = s.markX - LAND_REACH * (1 - k) + 0.15 * k;
        if (s.t > 1.8) showResult();
        break;
      }
      case 'foul':
        s.v = Math.max(0, s.v - 8 * dt);
        s.x += s.v * dt;
        s.stride += s.v * dt;
        s.y = 0;
        if (s.t > 1.6) showResult();
        break;
    }
    var view = viewWidthM();
    var lead = s.phase === 'flight' || s.phase === 'contact' || s.phase === 'landed' ? 0.33 : 0.28;
    s.cam += (s.x - view * lead - s.cam) * Math.min(1, dt * 6);
  }

  // ---- 결과 / 순위 (최고 기록 → 두 번째 기록 …) ----
  function best(p) {
    var b = null;
    p.marks.forEach(function (m) { if (m.dist != null && (b == null || m.dist > b)) b = m.dist; });
    return b;
  }
  function sortedMarks(p) {
    return p.marks.map(function (m) { return m.dist == null ? -1 : m.dist; }).sort(function (a, b) { return b - a; });
  }
  function compare(a, b) {
    var ma = sortedMarks(a), mb = sortedMarks(b);
    for (var i = 0; i < Math.max(ma.length, mb.length); i++) {
      var x = ma[i] == null ? -1 : ma[i], y = mb[i] == null ? -1 : mb[i];
      if (x !== y) return y - x;
    }
    return 0;
  }
  function ranking() {
    var list = match.players.slice().sort(compare);
    var rank = 0;
    return list.map(function (p, i) {
      if (i === 0 || compare(list[i - 1], p) !== 0) rank = i + 1;
      return { p: p, rank: rank };
    });
  }
  function medal(r) { return r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : r; }
  function fmtDist(d) { return d.toFixed(2) + ' m'; }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function rankingRows(highlight, withMarks) {
    return ranking().map(function (r) {
      var b = best(r.p);
      var marks = r.p.marks.map(function (m) { return m.dist == null ? 'X' : m.dist.toFixed(2); }).join(' · ');
      return '<tr class="' + (r.p === highlight ? 'me' : '') + '">' +
        '<td class="rank">' + (b == null ? '-' : medal(r.rank)) + '</td>' +
        '<td><span style="color:' + r.p.color + '">●</span> ' + esc(r.p.name) +
        (withMarks && marks ? '<div class="marks">' + marks + '</div>' : '') + '</td>' +
        '<td class="num">' + (b == null ? (r.p.marks.length ? '기록 없음' : '-') : fmtDist(b)) + '</td></tr>';
    }).join('');
  }

  // 홉/스텝/점프 각각의 거리
  function segments() {
    var out = [];
    for (var i = 0; i < s.landings.length && i < s.takeoffs.length; i++) {
      var from = i === 0 ? LINE_X : s.takeoffs[i].x; // 첫 구간은 발판 선부터 잼 (일찍 뛰면 손해)
      out.push(PHASE_NAMES[i] + ' ' + (s.landings[i] - from).toFixed(2));
    }
    return out.join(' · ');
  }

  function showResult() {
    if (s.phase === 'result') return;
    s.phase = 'result';
    hideBanner();
    ui.timing.classList.add('hidden');
    var p = currentPlayer();
    var prevBest = best(p);
    var r = s.result;
    p.marks.push({ dist: r.dist });

    ui.resDist.classList.toggle('foul', r.dist == null);
    ui.resDist.textContent = r.dist == null ? '파울 ✕' : fmtDist(r.dist);
    ui.resBadge.textContent = r.dist != null && r.dist > WORLD_RECORD ? '🌍 세계 신기록!' : '개인 최고!';
    ui.resBadge.classList.toggle('hidden', !(r.dist != null && ((prevBest != null && r.dist > prevBest) || r.dist > WORLD_RECORD)));
    var lines = [];
    if (r.dist == null) lines.push(r.reason);
    if (s.takeoffs.length) lines.push('시속 ' + (s.takeoffs[0].v * 3.6).toFixed(1) + ' km/h · 각도 ' + s.takeoffs.map(function (t) { return t.angle.toFixed(1) + '°'; }).join(' / '));
    if (s.landings.length) lines.push(segments());
    if (s.timings.length) lines.push('리듬: ' + s.timings.join(' → '));
    ui.resDetail.innerHTML = lines.map(esc).join('<br>');
    ui.resTable.innerHTML = match.players.length > 1 ? rankingRows(p, false) : '';

    var last = match.turn + 1 >= totalTurns();
    if (last) ui.resNext.textContent = '최종 결과 보기';
    else {
      var np = match.players[(match.turn + 1) % match.players.length];
      ui.resNext.textContent = match.players.length > 1 ? '다음: ' + np.name : '다음 시기';
    }
    ui.result.classList.remove('hidden');
  }

  ui.resNext.addEventListener('click', function () {
    match.turn++;
    if (match.turn >= totalTurns()) showFinal();
    else beginTurn();
  });

  function showFinal() {
    ui.finalTable.innerHTML = '<tr><th></th><th>선수</th><th class="num">최고 기록</th></tr>' + rankingRows(null, true);
    show(ui.final);
    SO.olympic.onFinal('triple-jump', ranking().map(function (r) {
      return { idx: match.players.indexOf(r.p), rank: r.rank, valid: best(r.p) != null };
    }), ui);
    SO.sound.noise(2, 0.25, 2200);
  }

  ui.againBtn.addEventListener('click', function () {
    SO.enterGameMode();
    startMatch(match.players, match.attempts);
  });
  ui.setupBtn.addEventListener('click', startSetup);

  // ---- 화면 표시 ----
  function showBanner(text, red) {
    ui.banner.textContent = text;
    ui.banner.classList.toggle('red', !!red);
    ui.banner.classList.toggle('long', text.length > 5);
    ui.banner.classList.remove('hidden', 'pop');
    void ui.banner.offsetWidth;
    ui.banner.classList.add('pop');
  }
  function hideBanner() { ui.banner.classList.add('hidden'); }

  var timingTimer = null;
  function showTiming(text, cls) {
    ui.timing.textContent = text;
    ui.timing.className = 'timing ' + cls;
    void ui.timing.offsetWidth;
    ui.timing.classList.add('pop');
    clearTimeout(timingTimer);
    timingTimer = setTimeout(function () { ui.timing.classList.add('hidden'); }, 700);
  }

  var lastHud = '';
  function updateHud() {
    var flying = s.phase === 'flight' || s.phase === 'landed' || s.phase === 'result';
    var v = s.v;
    var a = s.angle;
    var remain = LINE_X - s.x;
    var zone = inZone();
    var lineText = s.phase === 'run' || s.phase === 'countdown' || s.phase === 'intro'
      ? (zone ? '점프 구간! ' : '선까지 ') + Math.max(0, remain).toFixed(1) + ' m'
      : '';
    var waiting = (s.phase === 'flight' && s.hop < 2 && s.pressEarly == null) || (s.phase === 'contact' && !s.pressedInContact);
    var key = [s.phase, v.toFixed(1), a.toFixed(1), lineText, zone, s.charging, s.hop, waiting, flying].join('|');
    if (key === lastHud) return;
    lastHud = key;
    ui.speed.textContent = (v * 3.6).toFixed(1);
    ui.angle.textContent = a.toFixed(1);
    ui.toLine.textContent = lineText;
    ui.toLine.classList.toggle('hidden', !lineText);
    ui.toLine.classList.toggle('zone', zone);
    ui.jumpBtn.classList.toggle('ready', (zone && !s.charging) || waiting);
    ui.jumpBtn.classList.toggle('holding', s.charging);
    // 홉 → 스텝 → 점프 진행 표시
    var chips = ui.phases.children;
    var current = s.phase === 'contact' ? s.hop + 1 : s.hop;
    for (var i = 0; i < 3; i++) {
      chips[i].classList.toggle('done', s.hop >= 0 && i < current);
      chips[i].classList.toggle('now', s.hop >= 0 && i === current && s.phase !== 'landed' && s.phase !== 'result' && s.phase !== 'foul');
    }
  }

  // ---- 그리기 ----
  var W = 0, H = 0, DPR = 1, PPM = 30, GROUND = 0;
  function viewWidthM() { return W / PPM; }
  function resize() {
    var r = ui.stage.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    ui.canvas.width = Math.round(W * DPR);
    ui.canvas.height = Math.round(H * DPR);
    PPM = Math.min(W / 10.5, H / 5);
    GROUND = H * 0.76;
  }
  window.addEventListener('resize', resize);

  function sx(x) { return (x - s.cam) * PPM; }
  function sy(y) { return GROUND - y * PPM; }

  function draw(time) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (s.shake > 0) ctx.translate(0, (Math.random() - 0.5) * 24 * s.shake);
    SO.stadium.draw(ctx, {
      width: W, base: GROUND, ppm: PPM, cam: s.cam, time: time,
      cheer: s.phase === 'landed' || (s.phase === 'result' && s.markX != null) ? 1 : 0.25,
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 트랙 (발판 선 너머 홉·스텝 구간까지) + 모래판 + 잔디
    var groundH = H - GROUND + 20;
    ctx.fillStyle = '#4d7c0f';
    ctx.fillRect(0, GROUND, W, groundH);
    ctx.fillStyle = '#c2410c';
    ctx.fillRect(sx(-50), GROUND, sx(LINE_X + PIT_START) - sx(-50), groundH);
    ctx.fillStyle = 'rgba(255, 210, 80, 0.28)';
    ctx.fillRect(sx(LINE_X - JUMP_ZONE), GROUND, JUMP_ZONE * PPM, groundH);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(sx(-50), GROUND + 2, sx(LINE_X + PIT_START) - sx(-50), 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 ' + Math.round(PPM * 0.4) + 'px system-ui, sans-serif';
    for (var m = 5; m < LINE_X; m += 5) {
      ctx.fillRect(sx(LINE_X - m) - 1, GROUND + 4, 2, 10);
      ctx.fillText(m + 'm', sx(LINE_X - m), GROUND + 26);
    }
    // 발판 선 너머 1m 눈금 (홉·스텝 착지 구간)
    for (var d0 = 1; d0 < PIT_START; d0++) {
      ctx.fillStyle = d0 % 5 === 0 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)';
      ctx.fillRect(sx(LINE_X + d0) - 1, GROUND + 3, 2, d0 % 5 === 0 ? 14 : 8);
      if (d0 % 5 === 0) ctx.fillText(d0 + '', sx(LINE_X + d0), GROUND + 30);
    }
    // 모래판
    ctx.fillStyle = '#e9c46a';
    ctx.fillRect(sx(LINE_X + PIT_START), GROUND - 2, (PIT_END - PIT_START) * PPM, groundH);
    ctx.fillStyle = '#d4a94f';
    ctx.fillRect(sx(LINE_X + PIT_START), GROUND - 2, (PIT_END - PIT_START) * PPM, 3);
    for (var d = PIT_START + 1; d < PIT_END; d++) {
      ctx.fillStyle = 'rgba(80,50,10,0.75)';
      ctx.fillRect(sx(LINE_X + d) - 1, GROUND + 2, 2, d % 5 === 0 ? 16 : 9);
      ctx.fillText(d + '', sx(LINE_X + d), GROUND + 30);
    }
    var wr = sx(LINE_X + WORLD_RECORD);
    if (wr > -40 && wr < W + 40) {
      ctx.fillStyle = '#fde047';
      ctx.fillRect(wr - 1.5, GROUND - PPM * 0.6, 3, PPM * 0.6 + 14);
      ctx.font = '800 ' + Math.round(Math.max(11, PPM * 0.3)) + 'px system-ui, sans-serif';
      ctx.fillText('WR ' + WORLD_RECORD, wr, GROUND - PPM * 0.8);
      ctx.font = '700 ' + Math.round(PPM * 0.4) + 'px system-ui, sans-serif';
    }
    // 발판 + 파울 라인
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(sx(LINE_X - 0.2), GROUND - 1, 0.2 * PPM, 8);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(sx(LINE_X), GROUND - 2, Math.max(3, 0.06 * PPM), 9);

    // 선수별 최고 기록 깃발
    match.players.forEach(function (pl) {
      var b = best(pl);
      if (b == null) return;
      var fx = sx(LINE_X + b);
      if (fx < -20 || fx > W + 20) return;
      ctx.fillStyle = '#334155';
      ctx.fillRect(fx - 1, GROUND - PPM * 0.9, 2, PPM * 0.9);
      ctx.fillStyle = pl.color;
      ctx.beginPath();
      ctx.moveTo(fx + 1, GROUND - PPM * 0.9);
      ctx.lineTo(fx + PPM * 0.45, GROUND - PPM * 0.78);
      ctx.lineTo(fx + 1, GROUND - PPM * 0.66);
      ctx.fill();
    });

    // 발자국 (홉·스텝 착지점)
    for (var fi = 0; fi < s.landings.length && fi < 2; fi++) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.ellipse(sx(s.landings[fi]), GROUND + 6, PPM * 0.16, 3.5, 0, 0, 6.283);
      ctx.fill();
      ctx.font = '800 ' + Math.round(Math.max(11, PPM * 0.3)) + 'px system-ui, sans-serif';
      ctx.fillText(PHASE_NAMES[fi], sx(s.landings[fi]), GROUND + 48);
    }

    // 착지 타이밍 원: 땅에 닿을수록 작아지고, 퍼펙트 구간이면 금색
    if (s.phase === 'flight' && s.hop < 2) {
      var lx = s.x0 + s.vx * s.flightDur;
      var remain = Math.max(0, (s.flightDur - s.flightT) / SLOWMO);
      var rr = PPM * (0.35 + remain * 2.2);
      var hot = remain <= TIMING[0].lim;
      ctx.strokeStyle = hot ? '#fde047' : s.pressEarly != null ? 'rgba(74,222,128,0.9)' : 'rgba(255,255,255,0.85)';
      ctx.lineWidth = hot ? 5 : 3;
      ctx.beginPath();
      ctx.ellipse(sx(lx), GROUND + 4, rr, rr * 0.35, 0, 0, 6.283);
      ctx.stroke();
      ctx.fillStyle = 'rgba(253,224,71,0.55)';
      ctx.beginPath();
      ctx.ellipse(sx(lx), GROUND + 4, PPM * 0.35, PPM * 0.12, 0, 0, 6.283);
      ctx.fill();
    }

    // 착지 자국 + 줄자
    if (s.markX != null) {
      ctx.fillStyle = 'rgba(120, 80, 20, 0.5)';
      ctx.beginPath();
      ctx.ellipse(sx(s.markX), GROUND + 3, PPM * 0.3, 5, 0, 0, 6.283);
      ctx.fill();
      if (s.result && s.result.dist != null && s.t > 0.3) {
        var y0 = GROUND + 62;
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(sx(LINE_X), y0); ctx.lineTo(sx(s.markX), y0);
        ctx.moveTo(sx(LINE_X), y0 - 7); ctx.lineTo(sx(LINE_X), y0 + 7);
        ctx.moveTo(sx(s.markX), y0 - 7); ctx.lineTo(sx(s.markX), y0 + 7);
        ctx.stroke();
        ctx.fillStyle = '#fde047';
        ctx.font = '800 ' + Math.round(PPM * 0.5) + 'px system-ui, sans-serif';
        ctx.fillText(fmtDist(s.result.dist), Math.max(60, Math.min(W - 60, (sx(LINE_X) + sx(s.markX)) / 2)), y0 + 22);
      }
    }

    // 그림자 + 선수
    var shadowScale = Math.max(0.3, 1 - s.y / 3);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(sx(s.x), GROUND + 2, PPM * 0.35 * shadowScale, 4 * shadowScale, 0, 0, 6.283);
    ctx.fill();
    drawRunner(currentPlayer().color);

    // 각도 화살표 (누르고 있는 동안)
    if (s.charging) {
      var a = s.angle * Math.PI / 180;
      var ox = sx(s.x) + PPM * 0.2, oy = GROUND - 2, len = PPM * 1.6;
      ctx.strokeStyle = '#fde047';
      ctx.fillStyle = '#fde047';
      ctx.lineWidth = 4;
      var ex = ox + Math.cos(a) * len, ey = oy - Math.sin(a) * len;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(a) * 10, ey - Math.sin(a) * 10);
      ctx.lineTo(ex + Math.cos(a + 2.4) * 12, ey - Math.sin(a + 2.4) * 12);
      ctx.lineTo(ex + Math.cos(a - 2.4) * 12, ey - Math.sin(a - 2.4) * 12);
      ctx.fill();
    }
  }

  function drawRunner(color) {
    var pose;
    var ph = s.phase;
    if (ph === 'flight') {
      var f = s.flightDur > 0 ? Math.min(1, s.flightT / s.flightDur) : 1;
      if (s.hop < 2) {
        // 홉·스텝: 다리를 앞뒤로 크게 벌린 바운딩 자세
        pose = {
          hip: 0.95, lean: 0.12,
          legs: [[0.9 - 0.3 * f, 0.2 - 0.4 * f], [-0.7, -1.3]],
          arms: [[1.6 - 0.6 * f, 2.2], [-0.8, -0.3]],
        };
      } else {
        pose = {
          hip: 0.95, lean: -0.15 + f * 0.35,
          legs: [[0.4 + f * 1.1, 0.1 + f * 1.4], [0.9 + f * 0.6, 0.6 + f * 0.9]],
          arms: [[2.9 - f * 1.6, 2.9 - f * 1.4], [2.6 - f * 1.4, 2.7 - f * 1.2]],
        };
      }
    } else if (ph === 'contact') {
      pose = { hip: 0.82, lean: 0.2, legs: [[0.25, 0.05], [-0.5, -1.0]], arms: [[-0.6, -0.2], [0.8, 1.6]] };
    } else if ((ph === 'landed' || ph === 'result') && s.markX != null) {
      var k = ph === 'result' ? 1 : Math.min(1, s.t / 0.25);
      pose = { hip: 0.95 - 0.62 * k, lean: 0.2 + 0.35 * k, legs: [[1.5, 1.55], [1.4, 1.5]], arms: [[1.3, 1.5], [1.1, 1.3]] };
    } else if (ph === 'run' || ph === 'foul') {
      pose = SO.athlete.runPose(s.stride, Math.min(1, s.v / 6), s.charging ? -0.12 : 0, STRIDE);
    } else {
      pose = SO.athlete.standPose();
    }
    SO.athlete.draw(ctx, pose, { x: s.x, y: s.y, toX: sx, toY: sy, ppm: PPM, color: color });
  }

  // ---- 메인 루프 ----
  var prev = 0;
  function frame(time) {
    var dt = Math.min(0.05, (time - prev) / 1000 || 0);
    prev = time;
    if (match && s && !ui.game.classList.contains('hidden')) {
      if (s.phase !== 'intro' && s.phase !== 'result') update(dt);
      updateHud();
      draw(time);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 테스트/디버그용
  window.TripleJump = {
    state: function () { return s; },
    match: function () { return match; },
    landingIn: function () { return s.phase === 'flight' ? (s.flightDur - s.flightT) / SLOWMO : null; },
    constants: { LINE_X: LINE_X, JUMP_ZONE: JUMP_ZONE },
  };

  SO.registerSW('../../sw.js');
  if (SO.olympic.active()) SO.olympic.start('triple-jump', startMatch);
  else startSetup();
})();
