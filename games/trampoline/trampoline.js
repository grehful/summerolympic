/*
 * 트램폴린
 *
 * 1. 점프 버튼: 트램폴린에 닿는 순간 탭 (3단 뛰기처럼 타이밍 판정). 퍼펙트면 더 높이, 놓치면 낮아짐
 * 2. 회전 원판: 공중에서 손가락으로 원을 그린 만큼 몸이 돈다 (투포환처럼). 시계 방향 = 앞, 반대 = 뒤
 *    많이 돌수록 고난도. 높이 뛸수록 체공 시간이 길어 더 많이 돌 수 있다
 * 3. 닿을 때 발이 아래(정수 바퀴)에서 40° 넘게 벗어나 있으면 넘어져 루틴 종료
 * 4. 준비 바운스 3번 → 기술 10개. 점수 = 난도(D) + 실시(E, 10점 감점제) + 체공 점수(체공 시간 × 0.6)
 */
(function () {
  'use strict';

  // ---- 튜닝 값 ----
  var G = 9.81;
  var H_START = 0.8;        // 첫 바운스 높이 (m)
  var H_MIN = 0.6;
  var H_MAX = 8.5;
  var BED_TIME = 0.3;       // 트램폴린을 딛고 있는 시간 (초) — 이 안에 눌러야 함
  var EARLY = 0.3;          // 닿기 이만큼 전부터 눌러도 인정
  var WARMUP = 3;           // 준비 바운스
  var SKILLS = 10;          // 루틴 기술 수
  var LAND_OK = 40;         // 착지 허용 각도 (°)
  var TIMING = [            // 타이밍 오차 → 높이 변화, 실시 감점
    { lim: 0.06, dh: 0.9, ded: 0, label: '퍼펙트!', cls: 'perfect' },
    { lim: 0.12, dh: 0.5, ded: 0.05, label: '좋아요', cls: 'good' },
    { lim: 0.2, dh: 0.1, ded: 0.1, label: '아쉬워요', cls: 'ok' },
    { lim: 0.3, dh: -0.5, ded: 0.2, label: '', cls: 'late' },
  ];
  var MISS_KEEP = 0.55;     // 타이밍을 놓치면 높이가 이만큼으로
  var MISS_DED = 0.3;
  var FALL_DED = 2;
  var TOF_WEIGHT = 0.6;      // 체공 시간 1초당 점수

  var SO = window.SO;
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    setup: $('setup'), game: $('game'), final: $('final'),
    hudDot: $('hudDot'), hudName: $('hudName'), hudAttempt: $('hudAttempt'), hudBest: $('hudBest'),
    stage: $('stage'), canvas: $('canvas'),
    height: $('height'), skill: $('skill'), skillLabel: $('skillLabel'),
    rotChip: $('rotChip'), scoreChip: $('scoreChip'), timing: $('timing'), banner: $('banner'),
    intro: $('intro'), introTurn: $('introTurn'), introName: $('introName'), introGo: $('introGo'),
    result: $('result'), resScore: $('resScore'), resBadge: $('resBadge'), resDetail: $('resDetail'),
    resTable: $('resTable'), resNext: $('resNext'),
    spinPad: $('spinPad'), spinDot: $('spinDot'), spinText: $('spinText'), spinSub: $('spinSub'),
    jumpBtn: $('jumpBtn'),
    finalTable: $('finalTable'), againBtn: $('againBtn'), setupBtn: $('setupBtn'),
  };
  var ctx = ui.canvas.getContext('2d');

  // ---- 경기 진행 상태 ----
  var match = null;   // { players: [{name,color,routines:[{total,D,E,T,skills,fall}]}], attempts, turn }
  var s = null;

  function currentPlayer() { return match.players[match.turn % match.players.length]; }
  function currentRound() { return Math.floor(match.turn / match.players.length) + 1; }
  function totalTurns() { return match.players.length * match.attempts; }

  function newRoutine() {
    s = {
      phase: 'intro',     // intro → air ⇄ bed → done | fallen → result
      h: H_START, apex: 0,
      y: 0, vy: 0, airT: 0, airDur: 0, bedT: 0, t: 0,
      launches: 0, flightSkill: 0,
      accum: 0, lastAngle: null, lastMove: -1, halfTurns: 0,
      pressEarly: null, judged: false,
      timingDed: 0, landDed: 0,
      skills: [],
      fall: false,
      camY: 0,
      now: 0,
    };
  }

  // ---- 화면 전환 ----
  function show(el) {
    [ui.setup, ui.game, ui.final].forEach(function (x) { x.classList.toggle('hidden', x !== el); });
  }

  function startSetup() {
    show(ui.setup);
    SO.setupPlayers(ui.setup, {
      title: '🤸‍♀️ 트램폴린',
      storageKey: 'trampoline',
      maxPlayers: 8,
      attemptChoices: [1, 2, 3],
      defaultAttempts: 1,
      attemptLabel: '1인당 루틴 수',
      attemptUnit: '번',
      backHref: '../../',
    }, function (cfg) {
      SO.enterGameMode();
      startMatch(cfg.players, cfg.attempts);
    });
  }

  function startMatch(players, attempts) {
    match = {
      players: players.map(function (p) { return { name: p.name, color: p.color, routines: [] }; }),
      attempts: attempts,
      turn: 0,
    };
    show(ui.game);
    resize();
    beginTurn();
  }

  // ---- 올림픽 모드: 나라 실력(★)에 따른 보너스 (★1 = 보너스 없음) ----
  var BASE = { EARLY: EARLY, LAND_OK: LAND_OK, LIMS: TIMING.map(function (t) { return t.lim; }) };
  function applyBoost(idx) {
    var k = SO.olympic.k('trampoline', idx);
    var widen = 1 + 0.4 * k;               // 타이밍 판정이 넉넉해짐
    TIMING.forEach(function (t, i) { t.lim = BASE.LIMS[i] * widen; });
    EARLY = BASE.EARLY * widen;
    LAND_OK = BASE.LAND_OK + 10 * k;       // 착지 허용 각도
  }

  function beginTurn() {
    applyBoost(match.turn % match.players.length);
    newRoutine();
    var p = currentPlayer();
    ui.hudDot.style.background = p.color;
    ui.hudName.textContent = p.name;
    ui.hudAttempt.textContent = match.attempts > 1 ? currentRound() + '/' + match.attempts + '번째 루틴' : '';
    var b = best(p);
    ui.hudBest.textContent = b == null ? '' : '최고 ' + b.toFixed(2);
    ui.introTurn.textContent = (match.attempts > 1 ? currentRound() + '번째 루틴' : '루틴') + (match.players.length > 1 ? ' · ' + (match.turn % match.players.length + 1) + '번째 선수' : '');
    ui.introTurn.textContent += SO.olympic.introNote('trampoline', match.turn % match.players.length);
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
    showBanner('준비 바운스', false);
    setTimeout(function () { if (ui.banner.textContent === '준비 바운스') hideBanner(); }, 900);
    launch();
  });

  // ---- 바운스 ----
  function launch() {
    s.launches++;
    s.flightSkill = s.launches > WARMUP ? s.launches - WARMUP : 0;
    s.apex = s.h;
    s.vy = Math.sqrt(2 * G * s.h);
    s.airDur = 2 * s.vy / G;
    s.airT = 0;
    s.y = 0;
    s.phase = 'air';
    s.accum = 0;
    s.halfTurns = 0;
    s.pressEarly = null;
    s.judged = false;
    SO.sound.sweep(220 + s.h * 40, 500 + s.h * 60, 0.25, 'triangle', 0.12);
    if (s.flightSkill === 1) showBanner('루틴 시작!', false);
    else if (s.flightSkill === 2) hideBanner();
  }

  function rotTurns() { return s.accum / (2 * Math.PI); }

  function touchdown() {
    s.y = 0;
    if (s.flightSkill > 0) {
      var rot = rotTurns();
      var n = Math.round(rot);
      var err = Math.abs(rot - n) * 360;
      if (err > LAND_OK) return fall(err);
      var k = Math.abs(n);
      var d = 0.5 * k + (k >= 2 ? 0.2 : 0) + (k >= 3 ? 0.3 : 0) + (k >= 4 ? 0.5 : 0);
      var landDed = err <= 10 ? 0 : err <= 20 ? 0.1 : err <= 30 ? 0.2 : 0.3;
      s.landDed += landDed;
      var skill = { n: k, dir: n > 0 ? 'front' : n < 0 ? 'back' : '', err: err, d: d, tof: s.airDur };
      s.skills.push(skill);
      if (k > 0) {
        showBanner(trickName(skill) + (k >= 2 ? '!' : ''), false);
        if (k >= 3) SO.sound.noise(1.2, 0.25, 2200);
      }
      if (s.flightSkill >= SKILLS) return finish();
    }
    s.phase = 'bed';
    s.bedT = 0;
    SO.sound.noise(0.12, 0.35, 400); // 텅
    SO.vibrate(12);
    if (s.pressEarly != null) judge(s.pressEarly, true);
  }

  function trickName(sk) {
    if (!sk.n) return '스트레이트 점프';
    var dir = sk.dir === 'front' ? '앞 ' : '뒤 ';
    var names = ['', '공중제비', '더블 공중제비', '트리플 공중제비', '쿼드러플 공중제비'];
    return dir + (names[sk.n] || sk.n + '회전 공중제비');
  }

  function judge(err, early) {
    var g = TIMING[TIMING.length - 1];
    for (var i = 0; i < TIMING.length; i++) { if (err <= TIMING[i].lim) { g = TIMING[i]; break; } }
    s.h = Math.max(H_MIN, Math.min(H_MAX, s.h + g.dh));
    if (s.launches >= WARMUP) s.timingDed += g.ded; // 루틴 기술로 이어지는 바운스만 감점
    s.judged = true;
    var label = g.label || (early ? '빨랐어요' : '늦었어요');
    if (g.cls === 'ok') label = early ? '조금 빨라요' : '조금 늦어요';
    showTiming(label, g.cls);
    if (g.cls === 'perfect') { SO.sound.beep(1320, 0.08, 'sine', 0.16); SO.vibrate([15, 20, 15]); }
  }

  function fall(err) {
    s.phase = 'fallen';
    s.t = 0;
    s.fall = true;
    s.fallErr = err;
    showBanner('넘어졌어요!', true);
    SO.sound.noise(0.4, 0.6, 300);
    SO.sound.beep(140, 0.5, 'sawtooth', 0.2);
    SO.vibrate([80, 40, 120]);
  }

  function finish() {
    s.phase = 'done';
    s.t = 0;
    showBanner('착지! 루틴 끝', false);
    SO.sound.noise(1.8, 0.3, 2200);
    SO.vibrate([30, 30, 30]);
  }

  // ---- 입력: 점프 ----
  function jumpDown() {
    if (s.phase === 'air') {
      var remain = s.airDur - s.airT;
      if (remain > EARLY) { showTiming('너무 빨라요', 'late'); return; }
      if (s.pressEarly == null) s.pressEarly = remain;
    } else if (s.phase === 'bed' && !s.judged) {
      judge(s.bedT, false);
    }
  }
  ui.jumpBtn.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    ui.jumpBtn.classList.add('pressed');
    clearTimeout(ui.jumpBtn._t);
    ui.jumpBtn._t = setTimeout(function () { ui.jumpBtn.classList.remove('pressed'); }, 80);
    jumpDown();
  });
  document.addEventListener('contextmenu', function (e) { if (!ui.game.classList.contains('hidden')) e.preventDefault(); });

  // ---- 입력: 회전 원판 ----
  var spinId = null;
  function padCenter() {
    var r = ui.spinPad.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  ui.spinPad.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (spinId != null) return;
    try { ui.spinPad.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    spinId = e.pointerId;
    var c = padCenter();
    s.lastAngle = Math.atan2(e.clientY - c.y, e.clientX - c.x);
  });
  ui.spinPad.addEventListener('pointermove', function (e) {
    if (e.pointerId !== spinId) return;
    var c = padCenter();
    var dx = e.clientX - c.x, dy = e.clientY - c.y;
    if (Math.hypot(dx, dy) < 20) return;
    var a = Math.atan2(dy, dx);
    var d = a - s.lastAngle;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    s.lastAngle = a;
    ui.spinDot.style.left = (50 + 50 * Math.cos(a)) + '%';
    ui.spinDot.style.top = (50 + 50 * Math.sin(a)) + '%';
    if (s.phase !== 'air' || s.flightSkill === 0) return; // 루틴 비행 중에만 회전
    s.accum += d;
    s.lastMove = s.now;
    var half = Math.floor(Math.abs(rotTurns()) * 2);
    if (half > s.halfTurns) {
      s.halfTurns = half;
      SO.sound.sweep(300, 600, 0.1, 'triangle', 0.06);
      SO.vibrate(8);
    }
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    ui.spinPad.addEventListener(ev, function (e) { if (e.pointerId === spinId) spinId = null; });
  });

  // 키보드 (PC 테스트용): ↑ = 점프, ← → = 회전
  document.addEventListener('keydown', function (e) {
    if (!match || ui.game.classList.contains('hidden')) return;
    if (e.code === 'ArrowUp' && !e.repeat) { e.preventDefault(); jumpDown(); }
    if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && s.phase === 'air' && s.flightSkill > 0) {
      e.preventDefault();
      s.accum += (e.code === 'ArrowRight' ? 1 : -1) * Math.PI / 4;
      s.lastMove = s.now;
    }
  });

  // ---- 진행 ----
  function update(dt) {
    s.now += dt;
    s.t += dt;
    switch (s.phase) {
      case 'air':
        s.airT += dt;
        s.y = s.vy * s.airT - 0.5 * G * s.airT * s.airT;
        if (s.airT >= s.airDur) touchdown();
        break;
      case 'bed':
        s.bedT += dt;
        s.y = -Math.sin(Math.PI * Math.min(1, s.bedT / BED_TIME)) * Math.min(0.9, 0.25 + s.apex * 0.08);
        if (s.bedT >= BED_TIME) {
          if (!s.judged) {
            s.h = Math.max(H_MIN, s.h * MISS_KEEP);
            if (s.launches >= WARMUP) s.timingDed += MISS_DED;
            showTiming('타이밍 놓침', 'late');
          }
          launch();
        }
        break;
      case 'done':
      case 'fallen':
        s.y = Math.max(-0.3, -Math.sin(Math.PI * Math.min(1, s.t / 0.4)) * 0.4);
        if (s.t > 1.8) showResult();
        break;
    }
    var viewH = (H - 150) / PPM;
    var target = Math.max(0, s.y + 1.6 - viewH * 0.55);
    s.camY += (target - s.camY) * Math.min(1, dt * 8);
  }

  // ---- 점수 ----
  function score() {
    var D = s.skills.reduce(function (n, k) { return n + k.d; }, 0);
    var T = s.skills.reduce(function (n, k) { return n + k.tof; }, 0) * TOF_WEIGHT;
    var E = Math.max(0, 10 - s.timingDed - s.landDed - (s.fall ? FALL_DED : 0));
    return { D: D, E: E, T: T, total: D + E + T };
  }

  // ---- 결과 / 순위 ----
  function best(p) {
    var b = null;
    p.routines.forEach(function (r) { if (b == null || r.total > b) b = r.total; });
    return b;
  }
  function compare(a, b) {
    var ba = best(a), bb = best(b);
    return (bb == null ? -1 : bb) - (ba == null ? -1 : ba);
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
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function skillCode(k) { return k.n ? (k.dir === 'front' ? '↻' : '↺') + k.n : '–'; }

  function rankingRows(highlight, withMarks) {
    return ranking().map(function (r) {
      var b = best(r.p);
      var marks = r.p.routines.map(function (x) { return x.total.toFixed(2) + (x.fall ? '(넘어짐)' : ''); }).join(' · ');
      return '<tr class="' + (r.p === highlight ? 'me' : '') + '">' +
        '<td class="rank">' + (b == null ? '-' : medal(r.rank)) + '</td>' +
        '<td><span style="color:' + r.p.color + '">●</span> ' + esc(r.p.name) +
        (withMarks && marks && match.attempts > 1 ? '<div class="marks">' + marks + '</div>' : '') + '</td>' +
        '<td class="num">' + (b == null ? '-' : b.toFixed(2) + '점') + '</td></tr>';
    }).join('');
  }

  function showResult() {
    if (s.phase === 'result') return;
    s.phase = 'result';
    hideBanner();
    ui.timing.classList.add('hidden');
    var p = currentPlayer();
    var prevBest = best(p);
    var sc = score();
    p.routines.push({ total: sc.total, D: sc.D, E: sc.E, T: sc.T, fall: s.fall, skills: s.skills.slice() });

    ui.resScore.classList.toggle('foul', s.fall);
    ui.resScore.textContent = sc.total.toFixed(2) + '점';
    ui.resBadge.classList.toggle('hidden', !(prevBest != null && sc.total > prevBest));
    var lines = [
      '난도 D ' + sc.D.toFixed(1) + ' · 실시 E ' + sc.E.toFixed(2) + ' · 체공 ' + sc.T.toFixed(2),
      '기술 ' + s.skills.length + '/' + SKILLS + ': ' + (s.skills.map(skillCode).join(' ') || '없음'),
    ];
    var bestSkill = s.skills.reduce(function (m, k) { return k.n > (m ? m.n : 0) ? k : m; }, null);
    if (bestSkill) lines.push('최고 기술: ' + trickName(bestSkill));
    if (s.fall) lines.push('넘어짐 — 착지 각도가 ' + Math.round(s.fallErr) + '° 틀어졌어요 (실시 -' + FALL_DED + ')');
    ui.resDetail.innerHTML = lines.map(esc).join('<br>');
    ui.resTable.innerHTML = match.players.length > 1 ? rankingRows(p, false) : '';

    var last = match.turn + 1 >= totalTurns();
    if (last) ui.resNext.textContent = '최종 결과 보기';
    else {
      var np = match.players[(match.turn + 1) % match.players.length];
      ui.resNext.textContent = match.players.length > 1 ? '다음: ' + np.name : '다음 루틴';
    }
    ui.result.classList.remove('hidden');
  }

  ui.resNext.addEventListener('click', function () {
    match.turn++;
    if (match.turn >= totalTurns()) showFinal();
    else beginTurn();
  });

  function showFinal() {
    ui.finalTable.innerHTML = '<tr><th></th><th>선수</th><th class="num">최고 점수</th></tr>' + rankingRows(null, true);
    show(ui.final);
    SO.olympic.onFinal('trampoline', ranking().map(function (r) {
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
    clearTimeout(showBanner._t);
    if (!red) showBanner._t = setTimeout(hideBanner, 850);
  }
  function hideBanner() { ui.banner.classList.add('hidden'); }

  var timingTimer = null;
  function showTiming(text, cls) {
    ui.timing.textContent = text;
    ui.timing.className = 'timing ' + cls;
    void ui.timing.offsetWidth;
    ui.timing.classList.add('pop');
    clearTimeout(timingTimer);
    timingTimer = setTimeout(function () { ui.timing.classList.add('hidden'); }, 650);
  }

  var lastHud = '';
  function updateHud() {
    var air = s.phase === 'air';
    var routine = s.flightSkill > 0;
    var rot = rotTurns();
    var off = Math.abs(rot - Math.round(rot)) * 360;
    var rotText = air && routine ? '회전 ' + rot.toFixed(2).replace('-', '') + ' ' + (rot > 0.05 ? '↻' : rot < -0.05 ? '↺' : '') : '';
    var sc = score();
    var scoreText = s.skills.length ? 'D ' + sc.D.toFixed(1) + ' · 체공 ' + sc.T.toFixed(1) : '';
    var ready = (air && s.airDur - s.airT <= EARLY && s.pressEarly == null) || (s.phase === 'bed' && !s.judged);
    var skillText = s.launches === 0 ? '준비' : routine ? s.flightSkill + '/' + SKILLS : '준비 ' + s.launches + '/' + WARMUP;
    var key = [s.phase, s.apex.toFixed(1), skillText, rotText, off > LAND_OK, scoreText, ready, routine].join('|');
    if (key === lastHud) return;
    lastHud = key;
    ui.height.textContent = s.apex.toFixed(1);
    ui.skill.textContent = skillText;
    ui.rotChip.textContent = rotText;
    ui.rotChip.classList.toggle('ok', !!rotText && off <= LAND_OK);
    ui.rotChip.classList.toggle('bad', !!rotText && off > LAND_OK);
    ui.scoreChip.textContent = scoreText;
    ui.jumpBtn.classList.toggle('ready', ready);
    ui.spinPad.classList.toggle('off', !(air && routine));
    ui.spinPad.classList.toggle('active', air && routine && s.now - s.lastMove < 0.2);
    ui.spinText.textContent = air && routine ? '↻ 돌려요!' : routine || s.launches >= WARMUP ? '↻ 돌리기' : '준비 바운스';
    ui.spinSub.textContent = air && routine ? '발이 아래로 오게 멈추기' : '공중에서 원 그리기';
  }

  // ---- 그리기 ----
  var W = 0, H = 0, DPR = 1, PPM = 60, BED = 0;
  function resize() {
    var r = ui.stage.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    ui.canvas.width = Math.round(W * DPR);
    ui.canvas.height = Math.round(H * DPR);
    PPM = Math.min(W / 5.6, (H - 150) / 5);
    BED = H * 0.8;
  }
  window.addEventListener('resize', resize);

  function sx(x) { return W / 2 + x * PPM; }
  function sy(y) { return BED - (y - s.camY) * PPM; }

  function draw(time) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // 실내 경기장 배경
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b1a33');
    bg.addColorStop(1, '#1e3a5f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // 높이 따라 움직이는 조명 띠와 관중석
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (var li = 0; li < 6; li++) {
      var ly = sy(li * 3 + 4);
      ctx.fillRect(0, ly, W, 8);
    }
    ctx.fillStyle = '#334155';
    for (var ci = 0; ci < 30; ci++) {
      var cy = sy(-0.2) - ((ci % 3) * 14) - 20;
      var cheer = s.phase === 'done' ? 1 : 0.2;
      ctx.beginPath();
      ctx.arc((ci + 0.5) * W / 30, cy + Math.sin(time / 130 + ci) * 4 * cheer, W / 70, 0, 6.283);
      ctx.fill();
    }

    // 높이 눈금 (왼쪽 기둥)
    var poleX = sx(-2.55);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(poleX - 2, sy(10), 4, sy(0) - sy(10));
    ctx.font = '700 ' + Math.round(Math.max(11, PPM * 0.2)) + 'px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (var m = 1; m <= 10; m++) {
      var my = sy(m);
      if (my < -20 || my > H + 20) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(poleX - 8, my, 16, 2);
      ctx.fillText(m + 'm', poleX + 12, my);
    }
    // 이번 점프 최고점 표시
    if (s.phase === 'air') {
      ctx.fillStyle = 'rgba(253,224,71,0.8)';
      ctx.fillRect(poleX - 12, sy(s.apex) - 1.5, 24, 3);
    }

    // 바닥 + 트램폴린
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, sy(-1.15), W, H);
    var footY = s.y < 0 ? s.y : 0;
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(sx(-2.1), sy(-1.15)); ctx.lineTo(sx(-1.9), sy(0));
    ctx.moveTo(sx(2.1), sy(-1.15)); ctx.lineTo(sx(1.9), sy(0));
    ctx.stroke();
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(sx(-2.2), sy(0) - 4, 0.4 * PPM, 10);
    ctx.fillRect(sx(1.8), sy(0) - 4, 0.4 * PPM, 10);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(sx(-1.8), sy(0));
    ctx.quadraticCurveTo(sx(0), sy(footY * 2), sx(1.8), sy(0));
    ctx.stroke();

    // 닿는 타이밍 원
    if (s.phase === 'air') {
      var remain = s.airDur - s.airT;
      if (remain < 0.7) {
        var rr = PPM * (0.35 + remain * 2.2);
        var hot = remain <= TIMING[0].lim;
        ctx.strokeStyle = hot ? '#fde047' : s.pressEarly != null ? 'rgba(74,222,128,0.9)' : 'rgba(255,255,255,0.85)';
        ctx.lineWidth = hot ? 5 : 3;
        ctx.beginPath();
        ctx.ellipse(sx(0), sy(0), rr, rr * 0.3, 0, 0, 6.283);
        ctx.stroke();
      }
    }
    // 그림자
    var sh = Math.max(0.2, 1 - Math.max(0, s.y) / 8);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(sx(0), sy(footY) + 3, PPM * 0.35 * sh, 4 * sh, 0, 0, 6.283);
    ctx.fill();

    drawAthlete(currentPlayer().color);
  }

  function drawAthlete(color) {
    var pose;
    var angle = s.accum;
    var hipY = s.y + 0.95;
    if (s.phase === 'fallen') {
      angle = Math.PI / 2 * (s.accum >= 0 ? 1 : -1);
      hipY = 0.2 + Math.max(0, s.y);
      pose = SO.athlete.standPose();
    } else if (s.phase === 'air' && s.flightSkill > 0 && s.now - s.lastMove < 0.18) {
      // 회전 중: 무릎을 가슴으로 당긴 턱 자세
      pose = { hip: 0.95, lean: 0.45, legs: [[2.1, 0.5], [2.0, 0.4]], arms: [[1.6, 0.4], [1.5, 0.3]] };
    } else if (s.phase === 'air') {
      // 쭉 편 자세: 올라갈 땐 팔을 위로
      var up = s.airT < s.airDur / 2;
      pose = { hip: 0.95, lean: 0, legs: [[0.05, 0.05], [-0.05, -0.05]], arms: up ? [[3.0, 3.1], [2.9, 3.0]] : [[2.2, 2.4], [2.0, 2.2]] };
    } else {
      // 트램폴린을 딛는 중: 무릎 살짝 굽히고 팔을 뒤로
      pose = { hip: 0.9, lean: 0.05, legs: [[0.35, -0.15], [0.25, -0.25]], arms: [[-0.5, -0.3], [-0.6, -0.4]] };
    }
    ctx.save();
    ctx.translate(sx(0), sy(hipY));
    ctx.rotate(angle);
    SO.athlete.draw(ctx, pose, {
      x: 0, y: 0,
      toX: function (x) { return x * PPM; },
      toY: function (y) { return -(y - pose.hip) * PPM; },
      ppm: PPM, color: color,
    });
    ctx.restore();
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
  window.Trampoline = {
    state: function () { return s; },
    match: function () { return match; },
    landingIn: function () { return s.phase === 'air' ? s.airDur - s.airT : null; },
    turns: function () { return rotTurns(); },
  };

  SO.registerSW('../../sw.js');
  if (SO.olympic.active()) SO.olympic.start('trampoline', startMatch);
  else startSetup();
})();
