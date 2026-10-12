/*
 * 리듬체조 (리본)
 *
 * 1. 음악에 맞춰 화면에 모양(물결, 원, 8자, 지그재그, 하트, 나선, 별, 두 바퀴 원)이 나타난다
 * 2. 금색 공이 박자에 맞춰 모양을 따라 움직인다. 손가락을 떼지 않고 공을 따라 그리면 리본이 따라온다
 * 3. 매 순간 손가락이 공(조금 늦는 것은 봐줌)에 가까울수록 높은 판정. 박자마다 퍼펙트/좋아요/놓침
 *    다 그리고 나면 아래의 선수가 내가 그린 그대로 리본으로 그 모양을 연기한다
 * 4. 요소 8개, 갈수록 템포가 빨라진다. 점수 = 난도 D(정확도 50% 이상인 요소의 값 합)
 *    + 실시 E(10점 감점제: 부정확·리본 떨어뜨림) + 예술 A(퍼펙트 박자 비율 × 3)
 */
(function () {
  'use strict';

  // ---- 튜닝 값 ----
  var BPM_START = 96;       // 첫 요소 템포
  var BPM_STEP = 4;         // 요소마다 빨라지는 만큼
  var COUNT_IN = 4;         // 첫 요소 전 박자 수
  var PREP = 2;             // 요소 사이 준비 박자
  var TOL_PERFECT = 0.14;   // 퍼펙트 거리 (모양 크기 대비)
  var TOL_GOOD = 0.45;       // 이 거리까지 점점 낮은 판정 (넘으면 0)
  var LAG = 0.12;           // 공보다 이만큼(초) 늦게 따라가도 인정
  var LEAD = 0.05;          // 이만큼 앞서가도 인정
  var DROP_TIME = 0.25;     // 손가락을 이만큼 떼고 있으면 리본 떨어뜨림
  var COUNT_ACC = 0.45;     // 난도로 인정되는 요소 정확도
  var E_DED = 0.7;          // 요소 하나의 부정확 감점 최대
  var DROP_DED = 0.5;
  var A_MAX = 3;
  var PERFORM = 0.75;       // 연기 시간 = 따라 그린 박자 × 이 값

  // 요소: 이름, 박자 수, 난도, 모양 함수 t(0~1) → [x, y] (-1~1, y는 아래로 +)
  function poly(pts) {
    var segs = [], total = 0;
    for (var i = 1; i < pts.length; i++) {
      var l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      segs.push(l); total += l;
    }
    return function (t) {
      var d = t * total;
      for (var i = 0; i < segs.length; i++) {
        if (d <= segs[i] || i === segs.length - 1) {
          var f = segs[i] ? Math.min(1, d / segs[i]) : 0;
          return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
        }
        d -= segs[i];
      }
    };
  }
  var TAU = Math.PI * 2;
  var STAR = [];
  for (var si = 0; si <= 5; si++) {
    var sa = -Math.PI / 2 + si * TAU * 2 / 5;
    STAR.push([Math.cos(sa), Math.sin(sa)]);
  }
  var ELEMENTS = [
    { name: '물결', beats: 4, d: 0.3, f: function (t) { return [-1 + 2 * t, -0.5 * Math.sin(2 * TAU * t)]; } },
    { name: '원', beats: 4, d: 0.4, f: function (t) { return [Math.sin(TAU * t), -Math.cos(TAU * t)]; } },
    { name: '8자', beats: 4, d: 0.5, f: function (t) { return [Math.sin(TAU * t), 0.55 * Math.sin(2 * TAU * t)]; } },
    { name: '지그재그', beats: 4, d: 0.5, f: poly([[-1, -0.6], [-0.5, 0.6], [0, -0.6], [0.5, 0.6], [1, -0.6]]) },
    { name: '하트', beats: 6, d: 0.6, f: function (t) {
      var a = TAU * t;
      return [Math.pow(Math.sin(a), 3), -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 16 + 0.1];
    } },
    { name: '나선', beats: 6, d: 0.7, f: function (t) { var r = 1 - 0.8 * t, a = 2 * TAU * t; return [r * Math.sin(a), -r * Math.cos(a)]; } },
    { name: '별', beats: 6, d: 0.8, f: poly(STAR) },
    { name: '두 바퀴 원', beats: 6, d: 0.8, f: function (t) { return [-Math.sin(2 * TAU * t), -Math.cos(2 * TAU * t)]; } },
  ];
  // 모양마다 같은 속도로 움직이도록 길이 기준 표를 만든다
  ELEMENTS.forEach(function (el) {
    var N = 240, pts = [], len = [0];
    for (var i = 0; i <= N; i++) pts.push(el.f(i / N));
    for (var j = 1; j <= N; j++) len.push(len[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
    el.pts = pts;
    el.len = len;
    el.total = len[N];
  });
  function pathAt(el, u) {
    u = Math.max(0, Math.min(1, u));
    var target = u * el.total, len = el.len, lo = 0, hi = len.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (len[mid] < target) lo = mid; else hi = mid; }
    var seg = len[hi] - len[lo], f = seg ? (target - len[lo]) / seg : 0;
    return [el.pts[lo][0] + (el.pts[hi][0] - el.pts[lo][0]) * f, el.pts[lo][1] + (el.pts[hi][1] - el.pts[lo][1]) * f];
  }
  // 배경 음악: 펜타토닉 멜로디 (요소마다 한 마디씩 이어짐)
  var MELODY = [523, 659, 784, 659, 880, 784, 659, 587, 523, 587, 659, 784, 1047, 880, 784, 659];

  var SO = window.SO;
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    setup: $('setup'), game: $('game'), final: $('final'),
    hudDot: $('hudDot'), hudName: $('hudName'), hudAttempt: $('hudAttempt'), hudBest: $('hudBest'),
    stage: $('stage'), canvas: $('canvas'),
    elem: $('elem'), elemLabel: $('elemLabel'), combo: $('combo'), elemChip: $('elemChip'), timing: $('timing'), banner: $('banner'),
    intro: $('intro'), introTurn: $('introTurn'), introName: $('introName'), introGo: $('introGo'),
    result: $('result'), resScore: $('resScore'), resBadge: $('resBadge'), resDetail: $('resDetail'),
    resTable: $('resTable'), resNext: $('resNext'),
    finalTable: $('finalTable'), againBtn: $('againBtn'), setupBtn: $('setupBtn'),
  };
  var ctx = ui.canvas.getContext('2d');

  // ---- 경기 진행 상태 ----
  var match = null;   // { players: [{name,color,routines:[{total,D,E,A,results,drops}]}], attempts, turn }
  var s = null;

  function currentPlayer() { return match.players[match.turn % match.players.length]; }
  function currentRound() { return Math.floor(match.turn / match.players.length) + 1; }
  function totalTurns() { return match.players.length * match.attempts; }

  // 박자 일정표: 요소마다 준비 박자 → 따라 그리는 박자 → 선수가 연기하는 박자
  function buildTimeline() {
    var beats = [], els = [], t = 0;
    ELEMENTS.forEach(function (el, i) {
      var bd = 60 / (BPM_START + BPM_STEP * i);
      var prep = i === 0 ? COUNT_IN : PREP;
      var start = t;
      for (var b = 0; b < prep; b++) { beats.push({ t: t, kind: 'prep', el: i, left: prep - b }); t += bd; }
      var moveStart = t;
      for (var m = 0; m < el.beats; m++) { beats.push({ t: t, kind: 'move', el: i, b: m }); t += bd; }
      var moveEnd = t;
      var perf = Math.round(el.beats * PERFORM);
      for (var q = 0; q < perf; q++) { beats.push({ t: t, kind: 'perform', el: i, b: q }); t += bd; }
      els.push({ start: start, moveStart: moveStart, moveEnd: moveEnd, end: t, bd: bd });
    });
    beats.push({ t: t, kind: 'end' });
    return { beats: beats, els: els, end: t };
  }

  function newRoutine() {
    var tl = buildTimeline();
    s = {
      phase: 'intro',     // intro → play → finish → result
      t: 0, now: 0,
      beats: tl.beats, els: tl.els, end: tl.end, nextBeat: 0, melody: 0,
      cur: -1,
      finger: null,      // { x, y } (화면 좌표, 누르고 있을 때만)
      upTime: 0,
      elemSum: 0, elemDur: 0, elemDrop: false, elemDropU: null,
      fallen: null,      // 연기 중 떨어뜨린 리본 막대 { x, y, vx, vy, a, va }
      hand: null,        // 마지막으로 그린 손·막대 위치
      beatSum: 0, beatDur: 0,
      combo: 0, maxCombo: 0, perfectBeats: 0, moveBeats: 0,
      results: [],       // { name, d, acc, counted, drop }
      drops: 0,
      ribbon: [],        // { x, y, t, vy }
      samples: [],       // 지금 요소에서 그린 궤적 { u, x, y, down } (모양 좌표)
      perfTrail: [],     // 선수가 연기하는 리본 끝 궤적
      cheered: false,
      finishT: 0,
      lastQ: 0,
    };
  }

  // ---- 화면 전환 ----
  function show(el) {
    [ui.setup, ui.game, ui.final].forEach(function (x) { x.classList.toggle('hidden', x !== el); });
  }

  function startSetup() {
    show(ui.setup);
    SO.setupPlayers(ui.setup, {
      title: '🎀 리듬체조',
      storageKey: 'rhythmic',
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
  var BASE = { TOL_PERFECT: TOL_PERFECT, TOL_GOOD: TOL_GOOD };
  function applyBoost(idx) {
    var k = SO.olympic.k('rhythmic', idx);
    TOL_PERFECT = BASE.TOL_PERFECT * (1 + 0.35 * k);   // 판정 거리가 넉넉해짐
    TOL_GOOD = BASE.TOL_GOOD * (1 + 0.35 * k);
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
    ui.introTurn.textContent += SO.olympic.introNote('rhythmic', match.turn % match.players.length);
    ui.introName.textContent = p.name;
    ui.introName.style.color = p.color;
    ui.result.classList.add('hidden');
    ui.intro.classList.remove('hidden');
    ui.timing.classList.add('hidden');
    ui.elemChip.textContent = '';
    hideBanner();
    updateHud();
  }

  ui.introGo.addEventListener('click', function () {
    SO.enterGameMode();
    SO.sound.unlock();
    ui.intro.classList.add('hidden');
    s.phase = 'play';
  });

  // ---- 손가락 입력 ----
  var pointerId = null;
  function pos(e) {
    var r = ui.stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  ui.stage.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.panel')) return;
    if (pointerId != null && pointerId !== e.pointerId) return;
    pointerId = e.pointerId;
    try { ui.stage.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    s.finger = pos(e);
    s.upTime = 0;
    e.preventDefault();
  });
  ui.stage.addEventListener('pointermove', function (e) {
    if (e.pointerId !== pointerId || !s.finger) return;
    s.finger = pos(e);
  });
  function release(e) {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    if (s) s.finger = null;
  }
  ui.stage.addEventListener('pointerup', release);
  ui.stage.addEventListener('pointercancel', release);

  // ---- 진행 ----
  function update(dt) {
    s.now += dt;
    if (s.phase === 'finish') {
      updateRibbon(dt);
      s.finishT += dt;
      if (s.finishT > 1.6) showResult();
      return;
    }
    s.t += dt;

    // 박자 넘어가는 순간 처리
    while (s.nextBeat < s.beats.length && s.t >= s.beats[s.nextBeat].t) {
      onBeat(s.beats[s.nextBeat]);
      s.nextBeat++;
      if (s.phase !== 'play') return;
    }

    // 지금 움직이는 요소면 판정
    var i = s.cur;
    var tl = s.els[i];
    if (tl && s.t >= tl.moveStart && s.t < tl.moveEnd) {
      var q = 0;
      s.samples.push({
        u: (s.t - tl.moveStart) / (tl.moveEnd - tl.moveStart),
        x: s.finger ? (s.finger.x - CX) / S : 0, y: s.finger ? (s.finger.y - CY) / S : 0,
        down: !!s.finger,
      });
      if (s.finger) {
        s.upTime = 0;
        var d = distToBall(i, s.t) / scale();
        q = Math.max(0, Math.min(1, 1 - (d - TOL_PERFECT) / (TOL_GOOD - TOL_PERFECT)));
      } else {
        s.upTime += dt;
        if (s.upTime > DROP_TIME && !s.elemDrop) {
          s.elemDrop = true;
          s.drops++;
          // 손을 놓은 순간 = 리본을 떨어뜨린 순간 (연기 때 그 자리에서 떨어뜨림)
          var mdur = tl.moveEnd - tl.moveStart;
          s.elemDropU = Math.max(0, (s.t - tl.moveStart - s.upTime) / mdur);
          SO.sound.sweep(400, 120, 0.3, 'sawtooth', 0.1);
          SO.vibrate(80);
        }
      }
      s.lastQ = q;
      s.elemSum += q * dt; s.elemDur += dt;
      s.beatSum += q * dt; s.beatDur += dt;
    }
    if (performing()) updatePerform(dt);
    updateRibbon(dt);
  }

  function onBeat(b) {
    // 직전 박자 판정
    if (s.beatDur > 0) judgeBeat();
    if (b.kind === 'perform' && b.b === 0) finishElement();
    if (b.kind === 'end') {
      s.phase = 'finish';
      s.finishT = 0;
      showBanner('피니시!', false);
      SO.sound.sweep(523, 1047, 0.5, 'triangle', 0.15);
      SO.sound.noise(1.8, 0.22, 2200);
      return;
    }
    if (b.el !== s.cur) {
      s.cur = b.el;
      s.elemSum = 0; s.elemDur = 0; s.elemDrop = false; s.elemDropU = null; s.upTime = 0;
      s.fallen = null;
      s.samples = [];
      s.perfTrail = [];
      s.cheered = false;
    }
    // 음악: 박자 소리 + 멜로디
    var down = b.kind === 'prep' ? b.left === 1 : b.b % 2 === 0;
    SO.sound.beep(down ? 110 : 82, 0.12, 'sine', 0.25);
    if (b.kind === 'prep') {
      SO.sound.beep(b.left === 1 ? 1320 : 990, 0.05, 'square', 0.06);
    } else {
      SO.sound.beep(MELODY[s.melody++ % MELODY.length], 0.22, 'triangle', 0.12);
    }
  }

  function judgeBeat() {
    var a = s.beatSum / s.beatDur;
    s.beatSum = 0; s.beatDur = 0;
    s.moveBeats++;
    if (a >= 0.85) {
      s.perfectBeats++;
      s.combo++;
      s.maxCombo = Math.max(s.maxCombo, s.combo);
      showTiming('퍼펙트!', 'perfect');
    } else if (a >= 0.45) {
      s.combo++;
      s.maxCombo = Math.max(s.maxCombo, s.combo);
      showTiming('좋아요', 'good');
    } else {
      s.combo = 0;
      showTiming('놓침', 'miss');
    }
  }

  function finishElement() {
    var el = ELEMENTS[s.cur];
    if (!el || s.results.length > s.cur) return;
    var acc = s.elemDur > 0 ? s.elemSum / s.elemDur : 0;
    var counted = acc >= COUNT_ACC;
    s.results.push({ name: el.name, d: el.d, acc: acc, counted: counted, drop: s.elemDrop, dropU: s.elemDrop ? s.elemDropU : null, samples: s.samples });
    s.ribbon = [];  // 이제부터는 선수가 연기하는 리본만 보이게
    showChip((counted ? '✓ ' : '✗ ') + el.name + ' ' + Math.round(acc * 100) + '%', counted ? 'good' : 'bad');
    if (counted && acc >= 0.85) SO.sound.sweep(880, 1760, 0.15, 'sine', 0.08);
  }

  // 손가락과 공 사이 거리 (조금 늦거나 이른 것은 봐줌)
  function distToBall(i, t) {
    var tl = s.els[i], el = ELEMENTS[i];
    var dur = tl.moveEnd - tl.moveStart;
    var best = Infinity;
    for (var k = 0; k <= 8; k++) {
      var tt = t - LAG + (LAG + LEAD) * k / 8;
      var p = toScreen(pathAt(el, (tt - tl.moveStart) / dur));
      var d = Math.hypot(p[0] - s.finger.x, p[1] - s.finger.y);
      if (d < best) best = d;
    }
    return best;
  }

  function ballPos() {
    var tl = s.els[s.cur];
    if (!tl) return null;
    var u = s.t < tl.moveStart ? 0 : (s.t - tl.moveStart) / (tl.moveEnd - tl.moveStart);
    return toScreen(pathAt(ELEMENTS[s.cur], u));
  }

  // ---- 선수 연기: 내가 그린 궤적을 그대로 리본으로 재현 ----
  function performing() {
    var tl = s.els[s.cur];
    return s.phase === 'play' && tl && s.t >= tl.moveEnd && s.t < tl.end;
  }
  function performU() {
    var tl = s.els[s.cur];
    return (s.t - tl.moveEnd) / (tl.end - tl.moveEnd);
  }
  // 선수 위치·크기와 연기 모양의 중심·크기
  function gymnastFrame() {
    var ppm = Math.min(H * (WIDE ? 0.2 : 0.11), 90);
    // 세로: 모양 바로 아래 가운데 / 가로: 모양 왼쪽 옆
    var gx = WIDE ? Math.max(W * 0.1, CX - S * 1.35) : W / 2, gy = FLOOR - 4;
    // 연기 모양은 내가 따라 그린 자리에 같은 크기로 (리본이 길게 휘날림)
    return { ppm: ppm, gx: gx, gy: gy, sp: S * 0.9, cx: CX, cy: CY };
  }
  // 연기 진행도 u 에서 리본 끝 위치 (손가락을 뗐던 곳이면 null = 리본이 떨어짐)
  function performTip(u) {
    var r = s.results[s.cur];
    var sm = r ? r.samples : [];
    if (!sm.length) return null;
    var lo = 0, hi = sm.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (sm[mid].u <= u) lo = mid; else hi = mid; }
    var q = sm[u >= sm[hi].u ? hi : lo];
    if (!q.down) return null;
    var f = gymnastFrame();
    return { x: f.cx + q.x * f.sp, y: f.cy + q.y * f.sp };
  }
  // 연기 중 리본을 떨어뜨렸나 (따라 그릴 때 손을 놓은 지점부터)
  function droppedNow() {
    var r = s.results[s.cur];
    return !!r && r.dropU != null && performU() >= r.dropU;
  }

  function updatePerform(dt) {
    var dropped = droppedNow();
    var tip = dropped ? null : performTip(performU());
    var tr = s.perfTrail;
    if (dropped && !s.fallen && s.hand) {
      // 막대를 놓침: 손에서 빠져나가 바닥으로
      s.fallen = { x: s.hand.x, y: s.hand.y, vx: (s.hand.dx || 0) * 120, vy: -120, a: s.hand.a, va: 7 * (Math.random() < 0.5 ? -1 : 1), t: s.now };
      SO.sound.sweep(500, 110, 0.45, 'triangle', 0.12);
      SO.vibrate([60, 40, 60]);
    }
    if (s.fallen) {
      var fo = s.fallen;
      fo.vy += 1400 * dt; fo.x = Math.max(10, Math.min(W - 10, fo.x + fo.vx * dt)); fo.y += fo.vy * dt; fo.a += fo.va * dt;
      if (fo.y > FLOOR - 10) {
        fo.y = FLOOR - 10;
        if (Math.abs(fo.vy) > 120) { fo.vy *= -0.35; SO.sound.beep(180, 0.05, 'square', 0.08); } else fo.vy = 0;
        fo.vx *= 0.6; fo.va *= 0.5;
        if (fo.vy === 0) fo.a += (Math.round(fo.a / Math.PI) * Math.PI - fo.a) * Math.min(1, dt * 10);  // 바닥에 눕힘
      }
    }
    if (tip) tr.push({ x: tip.x, y: tip.y, t: s.now, vy: 0 });
    else {
      // 리본이 바닥으로 흘러내려 그대로 깔림 (사라지지 않게 나이를 멈춤)
      tr.forEach(function (q) { q.vy += 1800 * dt; q.y = Math.min(FLOOR - 4 - (q.x % 5), q.y + q.vy * dt); if (dropped) q.t += dt; });
    }
    while (tr.length && s.now - tr[0].t > 1.3) tr.shift();
    var r = s.results[s.cur];
    if (r && !s.cheered && !dropped && r.dropU == null && performU() > 0.85) {
      s.cheered = true;
      if (r.acc >= 0.85) { SO.sound.noise(0.9, 0.14, 2500); showTiming('브라보!', 'perfect'); }
      else if (!r.counted) { SO.sound.sweep(300, 150, 0.3, 'triangle', 0.1); showTiming('휘청…', 'miss'); }
    }
  }

  function updateRibbon(dt) {
    var r = s.ribbon;
    if (s.finger) r.push({ x: s.finger.x, y: s.finger.y, t: s.now, vy: 0 });
    // 손가락을 떼면 리본이 흘러내림
    if (!s.finger) r.forEach(function (q) { q.vy += 1800 * dt; q.y = Math.min(FLOOR - 4 - (q.x % 5), q.y + q.vy * dt); q.t += dt; });
    while (r.length && s.now - r[0].t > 0.7) r.shift();
  }

  // ---- 점수 ----
  function score() {
    var D = 0, ded = 0;
    s.results.forEach(function (r) {
      if (r.counted) D += r.d;
      ded += (1 - r.acc) * E_DED;
    });
    ded += s.drops * DROP_DED;
    var E = Math.max(0, 10 - ded);
    var totalBeats = ELEMENTS.reduce(function (n, el) { return n + el.beats; }, 0);
    var A = A_MAX * s.perfectBeats / totalBeats;
    return { D: D, E: E, A: A, total: D + E + A };
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

  function rankingRows(highlight, withMarks) {
    return ranking().map(function (r) {
      var b = best(r.p);
      var marks = r.p.routines.map(function (x) { return x.total.toFixed(2); }).join(' · ');
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
    ui.elemChip.textContent = '';
    var p = currentPlayer();
    var prevBest = best(p);
    var sc = score();
    p.routines.push({ total: sc.total, D: sc.D, E: sc.E, A: sc.A, drops: s.drops, results: s.results.slice() });

    ui.resScore.classList.remove('foul');
    ui.resScore.textContent = sc.total.toFixed(2) + '점';
    ui.resBadge.classList.toggle('hidden', !(prevBest != null && sc.total > prevBest));
    var ok = s.results.filter(function (r) { return r.counted; }).length;
    var lines = [
      '난도 D ' + sc.D.toFixed(1) + ' · 실시 E ' + sc.E.toFixed(2) + ' · 예술 A ' + sc.A.toFixed(2),
      '성공 요소 ' + ok + '/' + ELEMENTS.length + ': ' + s.results.map(function (r) { return (r.counted ? '✓' : '✗') + r.name; }).join(' '),
      '퍼펙트 박자 ' + s.perfectBeats + '/' + s.moveBeats + ' · 최대 콤보 ' + s.maxCombo,
    ];
    if (s.drops) lines.push('리본 떨어뜨림 ' + s.drops + '번 (실시 -' + (s.drops * DROP_DED).toFixed(1) + ')');
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
    SO.olympic.onFinal('rhythmic', ranking().map(function (r) {
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
    timingTimer = setTimeout(function () { ui.timing.classList.add('hidden'); }, 450);
  }
  var chipTimer = null;
  function showChip(text, cls) {
    ui.elemChip.textContent = text;
    ui.elemChip.className = 'elem-chip ' + cls;
    clearTimeout(chipTimer);
    chipTimer = setTimeout(function () { ui.elemChip.textContent = ''; }, 1300);
  }

  var lastHud = '';
  function updateHud() {
    var el = ELEMENTS[s.cur];
    var elemText = el ? (s.cur + 1) + '/' + ELEMENTS.length + ' ' + el.name : '준비';
    var label = el ? '요소 · 난도 ' + el.d.toFixed(1) : '요소';
    var key = elemText + '|' + s.combo + '|' + label;
    if (key === lastHud) return;
    lastHud = key;
    ui.elem.textContent = elemText;
    ui.elemLabel.textContent = label;
    ui.combo.textContent = s.combo;
  }

  // ---- 그리기 ----
  var W = 0, H = 0, DPR = 1, CX = 0, CY = 0, S = 100, FLOOR = 0, WIDE = false;
  function resize() {
    var r = ui.stage.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    ui.canvas.width = Math.round(W * DPR);
    ui.canvas.height = Math.round(H * DPR);
    // 가로 화면이면 선수를 왼쪽에 두고 모양을 크게
    WIDE = W > H * 1.3;
    var top = WIDE ? 92 : 130, bottom = WIDE ? 14 : Math.min(H * 0.2, 150);
    FLOOR = H - 18;
    CX = WIDE ? W * 0.56 : W / 2;
    CY = top + (H - top - bottom) / 2;
    S = Math.max(40, Math.min(W * 0.38, (H - top - bottom) * 0.44));
  }
  window.addEventListener('resize', resize);
  function scale() { return S; }
  function toScreen(p) { return [CX + p[0] * S, CY + p[1] * S]; }

  function draw(time) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // 실내 경기장 + 카펫
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1a1036');
    bg.addColorStop(1, '#2e1b4f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // 조명
    var beatPulse = 0;
    if (s.phase === 'play' && s.nextBeat > 0) {
      var lb = s.beats[s.nextBeat - 1];
      beatPulse = Math.max(0, 1 - (s.t - lb.t) * 4);
    }
    var spot = ctx.createRadialGradient(CX, CY, 0, CX, CY, S * 1.8);
    spot.addColorStop(0, 'rgba(255,255,255,' + (0.08 + 0.06 * beatPulse) + ')');
    spot.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, W, H);
    // 카펫 (원근감 있는 바닥)
    ctx.fillStyle = '#3b2a6b';
    ctx.beginPath();
    ctx.moveTo(W * 0.12, FLOOR - H * 0.14);
    ctx.lineTo(W * 0.88, FLOOR - H * 0.14);
    ctx.lineTo(W, FLOOR + 18);
    ctx.lineTo(0, FLOOR + 18);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 관중
    ctx.fillStyle = '#4c3a7a';
    var cheer = s.phase === 'finish' ? 1 : 0.15;
    for (var ci = 0; ci < 26; ci++) {
      ctx.beginPath();
      ctx.arc((ci + 0.5) * W / 26, FLOOR - H * 0.17 - (ci % 2) * 10 + Math.sin(time / 120 + ci) * 4 * cheer, Math.min(W / 64, H / 45), 0, TAU);
      ctx.fill();
    }

    if (performing()) drawPerformGhost();
    else if (s.phase === 'play' && s.cur >= 0) drawGuide(time);
    drawGymnast(time);
    if (performing()) drawTrail(s.perfTrail, 1.3, 14, true, time);
    drawRibbon(time);
  }

  function drawGuide(time) {
    var el = ELEMENTS[s.cur], tl = s.els[s.cur];
    var moving = s.t >= tl.moveStart;
    var u = moving ? (s.t - tl.moveStart) / (tl.end - tl.moveStart) : 0;
    var N = el.pts.length - 1;
    var cut = Math.round(u * N);
    var fadeIn = Math.min(1, (s.t - tl.start) / (tl.bd * 0.8));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 전체 모양 (점선)
    ctx.setLineDash([2, 12]);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 * fadeIn) + ')';
    ctx.lineWidth = 6;
    strokePts(el, 0, N);
    ctx.setLineDash([]);
    // 지나간 부분
    if (cut > 0) {
      ctx.strokeStyle = 'rgba(244,114,182,0.45)';
      ctx.lineWidth = 10;
      strokePts(el, 0, cut);
    }
    // 앞으로 갈 길 (밝게)
    var ahead = Math.min(N, cut + Math.round(N * 0.22));
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.9 * fadeIn) + ')';
    ctx.lineWidth = 5;
    strokePts(el, cut, ahead);
    // 끝 표시
    var endP = toScreen(el.pts[N]);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(endP[0], endP[1], 6, 0, TAU);
    ctx.fill();

    // 공 + 판정 범위
    var b = ballPos();
    var pulse = moving ? 0 : 0.5 + 0.5 * Math.sin(time / 90);
    ctx.strokeStyle = 'rgba(253,224,71,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(b[0], b[1], TOL_GOOD * S, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(253,224,71,0.55)';
    ctx.beginPath();
    ctx.arc(b[0], b[1], TOL_PERFECT * S, 0, TAU);
    ctx.stroke();
    var g = ctx.createRadialGradient(b[0] - 4, b[1] - 4, 2, b[0], b[1], 16 + pulse * 4);
    g.addColorStop(0, '#fffbe6');
    g.addColorStop(0.5, '#fde047');
    g.addColorStop(1, 'rgba(234,179,8,0.2)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b[0], b[1], 16 + pulse * 4, 0, TAU);
    ctx.fill();
    // 준비 박자 카운트
    if (!moving) {
      var left = 0;
      for (var i = s.nextBeat - 1; i >= 0; i--) if (s.beats[i].kind === 'prep' && s.beats[i].el === s.cur) { left = s.beats[i].left; break; }
      if (left) {
        // 모양 가운데에 큰 카운트다운
        ctx.font = '900 ' + Math.round(S * 0.5) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,' + (0.35 + 0.5 * beatPulseOf()) + ')';
        ctx.fillText(String(left), CX, CY);
      }
    }
    // 손가락 위치 표시 (판정에 따라 색)
    if (s.finger && moving) {
      ctx.strokeStyle = s.lastQ >= 0.85 ? '#fde047' : s.lastQ >= 0.45 ? '#4ade80' : '#f87171';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.finger.x, s.finger.y, 26, 0, TAU);
      ctx.stroke();
    }
  }

  function beatPulseOf() {
    if (s.nextBeat === 0) return 0;
    return Math.max(0, 1 - (s.t - s.beats[s.nextBeat - 1].t) * 4);
  }

  function strokePts(el, a, b) {
    if (b <= a) return;
    ctx.beginPath();
    var p = toScreen(el.pts[a]);
    ctx.moveTo(p[0], p[1]);
    for (var i = a + 1; i <= b; i++) { p = toScreen(el.pts[i]); ctx.lineTo(p[0], p[1]); }
    ctx.stroke();
  }

  function drawRibbon(time) { drawTrail(s.ribbon, 0.7, 12, false, time); }

  function drawTrail(r, life, width, sparkle, time) {
    if (r.length < 2) return;
    var col = currentPlayer().color;
    var good = sparkle && s.results[s.cur] && s.results[s.cur].acc >= 0.85;
    ctx.lineCap = 'round';
    for (var i = 1; i < r.length; i++) {
      var age = (s.now - r[i].t) / life;
      var a = r[i - 1], b = r[i];
      var dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
      // 리본이 살랑거리도록 옆으로 흔들기
      var wob = Math.sin(i * 0.6 - time / 80) * 7 * age;
      var nx = -dy / l * wob, ny = dx / l * wob;
      ctx.strokeStyle = i % 2 ? col : '#f472b6';
      ctx.globalAlpha = Math.max(0, 1 - age);
      ctx.lineWidth = Math.max(1, width * (1 - age));
      ctx.beginPath();
      ctx.moveTo(a.x + nx, a.y + ny);
      ctx.lineTo(b.x + nx, b.y + ny);
      ctx.stroke();
      // 잘 그린 요소는 반짝이
      if (good && i % 6 === 0) {
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.arc(b.x + Math.sin(i + time / 90) * 10, b.y + Math.cos(i * 1.7 + time / 110) * 10, 2.5 * (1 - age) + 0.5, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // 연기하는 동안 위쪽엔 내가 그린 궤적을 흐리게 남겨둔다
  function drawPerformGhost() {
    var r = s.results[s.cur];
    if (!r) return;
    var fade = Math.max(0, 1 - performU() * 1.3);
    if (fade <= 0) return;
    ctx.strokeStyle = 'rgba(244,114,182,' + (0.5 * fade) + ')';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    var pen = false;
    r.samples.forEach(function (q) {
      if (!q.down) { pen = false; return; }
      var x = CX + q.x * S, y = CY + q.y * S;
      if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      pen = true;
    });
    ctx.stroke();
  }

  // 연기 동작: 비트마다 다음 자세로 부드럽게 넘어감
  var MOVES = [
    { hip: 1.02, lean: -0.05, legs: [[0.05, 0.05], [-0.05, -0.05]] },   // 까치발 (를르베)
    { hip: 1.35, lean: 0.1, legs: [[1.3, 1.1], [-1.3, -1.4]] },        // 다리 찢어 뛰기 (리프)
    { hip: 0.95, lean: 0.4, legs: [[0.0, 0.0], [-1.5, -1.6]] },        // 아라베스크
    { hip: 0.98, lean: 0, legs: [[0.05, 0.05], [1.4, -0.4]] },         // 파세
  ];
  function lerpPose(a, b, f) {
    var L = function (x, y) { return x + (y - x) * f; };
    return {
      hip: L(a.hip, b.hip), lean: L(a.lean, b.lean),
      legs: [[L(a.legs[0][0], b.legs[0][0]), L(a.legs[0][1], b.legs[0][1])], [L(a.legs[1][0], b.legs[1][0]), L(a.legs[1][1], b.legs[1][1])]],
    };
  }
  var READY = { hip: 0.95, lean: 0.05, legs: [[0.15, 0.1], [-0.3, -0.2]] };

  function drawGymnast(time) {
    var f = gymnastFrame();
    var ppm = f.ppm, gx = f.gx, gy = f.gy;
    var shY = gy - 1.45 * ppm;
    var body, armA = 2.7, tip = null, dejected = 0;
    if (performing()) {
      var tl = s.els[s.cur];
      var beatF = (s.t - tl.moveEnd) / tl.bd;
      var k = Math.floor(beatF), fr = beatF - k;
      var sm = fr * fr * (3 - 2 * fr);
      var a = k === 0 ? READY : MOVES[(s.cur + k - 1) % MOVES.length];
      var b = MOVES[(s.cur + k) % MOVES.length];
      body = lerpPose(a, b, sm);
      var r = s.results[s.cur];
      if (droppedNow()) {
        // 리본을 놓친 뒤: 연기를 멈추고 고개를 푹 숙임
        var since = (performU() - r.dropU) * (tl.end - tl.moveEnd);
        var g = Math.min(1, since / 0.5);
        var sad = { hip: 0.92, lean: 0.5, legs: [[0.04, 0.04], [-0.04, -0.04]] };
        body = lerpPose(body, sad, g * g * (3 - 2 * g));
        dejected = g;
        armA = 0.15;
      } else {
        if (r && !r.counted && performU() > 0.8) body = { hip: 0.8, lean: 0.7, legs: [[0.6, 0.2], [-0.5, -0.1]] };  // 휘청
        tip = performTip(performU());
      }
      shY = gy - (body.hip + 0.5) * ppm;
      if (tip) armA = Math.atan2(tip.x - gx, tip.y - shY);
      else if (!dejected) armA = 0.4;
    } else if (s.phase === 'finish' || s.phase === 'result') {
      body = { hip: 0.95, lean: -0.15, legs: [[0.05, 0.05], [-1.2, -1.0]] };
      armA = 3.0;
    } else {
      // 따라 그리는 동안엔 리본을 쥐고 박자에 맞춰 살짝 들썩
      var bob = s.phase === 'play' ? Math.abs(Math.sin(s.t * Math.PI / (s.els[Math.max(0, s.cur)].bd))) * 0.03 : 0;
      body = { hip: READY.hip + bob, lean: READY.lean, legs: READY.legs };
      armA = 0.5;
    }
    var backArm = dejected ? [-0.1 * dejected + (-2.4) * (1 - dejected), -0.05 * dejected + (-2.6) * (1 - dejected)] : [-2.4 + Math.sin(time / 300) * 0.3, -2.6];
    var pose = { hip: body.hip, lean: body.lean, legs: body.legs, arms: [[armA, dejected ? armA * 0.7 : armA], backArm] };
    SO.athlete.draw(ctx, pose, {
      x: 0, y: 0,
      toX: function (x) { return gx + x * ppm; },
      toY: function (y) { return gy - y * ppm; },
      ppm: ppm, color: currentPlayer().color,
    });
    // 리본 막대: 손에서 리본 끝 쪽으로
    var hx = gx + Math.sin(pose.lean) * 0.5 * ppm + Math.sin(armA) * 0.58 * ppm;
    var hy = shY - (-Math.cos(armA)) * 0.58 * ppm;
    var dirX = Math.sin(armA), dirY = Math.cos(armA);
    if (s.fallen || dejected) {
      drawFallen(ppm, time);
      if (dejected > 0.6) {
        // 고개 숙인 머리 위에 한숨
        var headX = gx + Math.sin(pose.lean) * 0.7 * ppm, headY = gy - (pose.hip + Math.cos(pose.lean) * 0.7) * ppm;
        ctx.globalAlpha = Math.min(1, (dejected - 0.6) * 2.5);
        ctx.font = '900 ' + Math.round(ppm * 0.35) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText('...', headX + 0.15 * ppm, headY - 0.3 * ppm - Math.sin(time / 300) * 3);
        ctx.globalAlpha = 1;
      }
      return;
    }
    s.hand = { x: hx, y: hy, a: Math.atan2(dirY, dirX), dx: dirX };
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + dirX * 0.55 * ppm, hy + dirY * 0.55 * ppm);
    ctx.stroke();
    var ex = hx + dirX * 0.55 * ppm, ey = hy + dirY * 0.55 * ppm;
    if (tip) {
      // 막대 끝에서 리본 끝까지 곡선으로 이어줌
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.quadraticCurveTo((ex + tip.x) / 2 + Math.sin(time / 120) * 12, (ey + tip.y) / 2 + 10, tip.x, tip.y);
      ctx.stroke();
    } else {
      // 연기 중이 아닐 땐 리본이 막대 끝에서 늘어져 있음
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      for (var j = 1; j <= 8; j++) ctx.lineTo(ex + Math.sin(time / 200 + j * 0.8) * 4 * j / 8, Math.min(FLOOR, ey + j * 0.1 * ppm));
      ctx.stroke();
    }
  }

  // 바닥에 떨어진 리본 막대
  function drawFallen(ppm) {
    var fo = s.fallen;
    if (!fo) return;
    var L = 0.55 * ppm;
    var ex = fo.x + Math.cos(fo.a) * L, ey = fo.y + Math.sin(fo.a) * L;
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fo.x, fo.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // 막대 끝에서 바닥에 깔린 리본으로 이어지는 끈
    var tr = s.perfTrail;
    if (tr.length) {
      var last = tr[tr.length - 1];
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.quadraticCurveTo((ex + last.x) / 2, Math.max(ey, last.y) + 6, last.x, last.y);
      ctx.stroke();
    }
  }

  // ---- 메인 루프 ----
  var prev = 0;
  function frame(time) {
    var dt = Math.min(0.05, (time - prev) / 1000 || 0);
    prev = time;
    if (match && s && !ui.game.classList.contains('hidden')) {
      if (s.phase === 'play' || s.phase === 'finish') update(dt);
      updateHud();
      draw(time);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 테스트/디버그용
  window.Rhythmic = {
    state: function () { return s; },
    match: function () { return match; },
    // 공의 화면(client) 좌표, 움직이는 중이 아니면 null
    ball: function () {
      if (!s || s.phase !== 'play' || s.cur < 0 || performing()) return null;
      var b = ballPos(), r = ui.stage.getBoundingClientRect();
      return { x: b[0] + r.left, y: b[1] + r.top, moving: s.t >= s.els[s.cur].moveStart, scale: S };
    },
    score: function () { return score(); },
  };

  SO.registerSW('../../sw.js');
  if (SO.olympic.active()) SO.olympic.start('rhythmic', startMatch);
  else startSetup();
})();
