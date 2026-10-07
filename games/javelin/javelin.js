/*
 * 창던지기
 *
 * 1. 왼발·오른발 버튼을 번갈아 눌러 도움닫기 (같은 발 두 번 = 삐끗, 속도 30% 손실)
 * 2. 경기 화면을 휙 스와이프하면 투척 (손가락을 대는 순간 발을 디뎌 위치 고정).
 *    마지막 0.1초의 방향 = 투척 각도, 속도 = 팔 힘
 *    투척 속도 = 기본 + 달리던 속도 + 팔 힘 → 바람(순풍/역풍)까지 반영해 비행
 * 3. 던진 뒤 몸이 미끄러져 멈추는 곳이 파울 라인을 넘으면 파울. 라인 전에 안 던져도 파울
 * 4. 45° 넘게 던지면 창이 꼬리부터 떨어져 파울. 35° 안팎이 가장 멀리 나감
 * 기록 = 착지 지점 - 파울 라인 (cm 아래 버림)
 */
(function () {
  'use strict';

  // ---- 튜닝 값 ----
  var LINE_X = 30;          // 출발점에서 파울 라인까지 (m)
  var V_MAX = 10.5;         // 이론상 최고 달리기 속도 (m/s)
  var STEP_BOOST = 0.9;     // 한 걸음마다 속도 증가
  var DRAG = 0.35;          // 초당 감속 비율
  var STUMBLE = 0.7;        // 삐끗하면 속도에 곱함
  var BRAKE = 10;           // 던진 뒤 감속 (m/s²) → 멈추는 거리 = v²/(2·BRAKE)
  var V_BASE = 8;           // 투척 속도 = V_BASE + RUN_GAIN·달리기 + ARM_GAIN·팔 힘
  var RUN_GAIN = 2.0;
  var ARM_GAIN = 8;
  var FLICK_MIN = 300;      // 이보다 느린 스와이프는 무시 (px/s)
  var FLAT_ANGLE = 45;      // 이보다 높으면 꼬리부터 떨어짐
  var BEST_ANGLE = 34;      // 이 각도를 넘으면 공기 저항으로 손해가 커짐
  var RELEASE_H = 1.9;
  var JAV_LEN = 2.6;
  var WIND_MAX = 2;
  var WORLD_RECORD = 98.48;
  var G = 9.81;

  var SO = window.SO;
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    setup: $('setup'), game: $('game'), final: $('final'),
    hudDot: $('hudDot'), hudName: $('hudName'), hudAttempt: $('hudAttempt'), hudBest: $('hudBest'),
    stage: $('stage'), canvas: $('canvas'),
    speed: $('speed'), angle: $('angle'), windChip: $('windChip'), toLine: $('toLine'),
    swipeHint: $('swipeHint'), banner: $('banner'),
    intro: $('intro'), introTurn: $('introTurn'), introName: $('introName'), introGo: $('introGo'),
    result: $('result'), resDist: $('resDist'), resBadge: $('resBadge'), resDetail: $('resDetail'),
    resTable: $('resTable'), resNext: $('resNext'),
    leftBtn: $('leftBtn'), rightBtn: $('rightBtn'),
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
      phase: 'intro',     // intro → run → flight → landed | foul → result
      t: 0,
      x: 0, v: 0, stride: 0,
      lastFoot: null, lastStep: 0, stumbleT: 0,
      wind: (Math.random() * 2 - 1) * WIND_MAX,
      releaseX: 0, runV: 0, angle: null, relV: 0, arm: 0,
      jx: 0, jy: 0, jvx: 0, jvy: 0, flightT: 0,
      landed: null,       // { x, angle, flat }
      result: null,
      cam: -3, camY: 0,
      throwT: 0,
      shake: 0,
      path: [],
    };
  }

  function stopDist(v) { return v * v / (2 * BRAKE); }

  // ---- 화면 전환 ----
  function show(el) {
    [ui.setup, ui.game, ui.final].forEach(function (x) { x.classList.toggle('hidden', x !== el); });
  }

  function startSetup() {
    show(ui.setup);
    SO.setupPlayers(ui.setup, {
      title: '🎯 창던지기',
      storageKey: 'javelin',
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

  function beginTurn() {
    newAttempt();
    var p = currentPlayer();
    ui.hudDot.style.background = p.color;
    ui.hudName.textContent = p.name;
    ui.hudAttempt.textContent = currentRound() + '/' + match.attempts + '차 시기';
    var b = best(p);
    ui.hudBest.textContent = b == null ? '' : '최고 ' + fmtDist(b);
    ui.introTurn.textContent = currentRound() + '차 시기' + (match.players.length > 1 ? ' · ' + (match.turn % match.players.length + 1) + '번째 선수' : '');
    ui.introName.textContent = p.name;
    ui.introName.style.color = p.color;
    ui.result.classList.add('hidden');
    ui.intro.classList.remove('hidden');
    hideBanner();
    updateHud();
  }

  ui.introGo.addEventListener('click', function () {
    SO.enterGameMode();
    ui.intro.classList.add('hidden');
    s.phase = 'run';
    s.t = 0;
    s.lastStep = 0;
    showBanner('출발!', false);
    setTimeout(function () { if (ui.banner.textContent === '출발!') hideBanner(); }, 600);
  });

  // ---- 입력: 번갈아 걷기 ----
  function step(foot, btn) {
    btn.classList.add('pressed');
    clearTimeout(btn._t);
    btn._t = setTimeout(function () { btn.classList.remove('pressed'); }, 70);
    if (s.phase !== 'run' || s.planting) return;
    if (foot === s.lastFoot) {
      s.v *= STUMBLE;
      s.stumbleT = 0.4;
      SO.vibrate([40, 30, 40]);
      SO.sound.beep(150, 0.12, 'sawtooth', 0.12);
      showBanner('삐끗!', true);
      setTimeout(function () { if (ui.banner.textContent === '삐끗!') hideBanner(); }, 500);
    } else {
      s.v += STEP_BOOST * Math.max(0, 1 - s.v / V_MAX);
      SO.sound.beep(foot === 'L' ? 180 + s.v * 12 : 200 + s.v * 12, 0.035, 'square', 0.05);
      SO.vibrate(8);
    }
    s.lastFoot = foot;
    s.lastStep = s.t;
  }
  ui.leftBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); step('L', ui.leftBtn); });
  ui.rightBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); step('R', ui.rightBtn); });
  document.addEventListener('contextmenu', function (e) { if (!ui.game.classList.contains('hidden')) e.preventDefault(); });

  // ---- 입력: 화면을 휙 스와이프해서 던지기 ----
  var swipeId = null;
  ui.stage.addEventListener('pointerdown', function (e) {
    if (s.phase !== 'run' || swipeId != null) return;
    if (e.target !== ui.canvas) return; // 안내/결과 패널 위는 제외
    e.preventDefault();
    try { ui.stage.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    swipeId = e.pointerId;
    s.planting = true; // 손가락을 대는 순간 발을 디디고 던질 자세 → 위치 고정
    s.path = [];
    SO.flick.add(s.path, e.clientX, e.clientY, e.timeStamp);
  });
  ui.stage.addEventListener('pointermove', function (e) {
    if (e.pointerId !== swipeId) return;
    SO.flick.add(s.path, e.clientX, e.clientY, e.timeStamp);
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    ui.stage.addEventListener(ev, function (e) {
      if (e.pointerId !== swipeId) return;
      swipeId = null;
      s.planting = false;
      SO.flick.add(s.path, e.clientX, e.clientY, e.timeStamp);
      if (s.phase !== 'run') return;
      var f = SO.flick.measure(s.path, 100);
      if (f.speed < FLICK_MIN || f.angle < -20 || f.angle > 100) return; // 그냥 톡 친 것 / 엉뚱한 방향은 무시 → 계속 달림
      throwJavelin(Math.max(0, Math.min(90, f.angle)), f.speed);
    });
  });

  // 키보드 (PC 테스트용): ← → 번갈아 = 달리기, 스페이스 = 35°로 던지기
  document.addEventListener('keydown', function (e) {
    if (!match || ui.game.classList.contains('hidden') || e.repeat) return;
    if (e.code === 'ArrowLeft') { e.preventDefault(); step('L', ui.leftBtn); }
    if (e.code === 'ArrowRight') { e.preventDefault(); step('R', ui.rightBtn); }
    if (e.code === 'Space' && s.phase === 'run') { e.preventDefault(); throwJavelin(35, 1800); }
  });

  function throwJavelin(angle, flickSpeed) {
    s.arm = Math.max(0, Math.min(1, (flickSpeed - 400) / 2000));
    s.runV = s.v;
    s.relV = V_BASE + RUN_GAIN * s.v + ARM_GAIN * s.arm;
    s.angle = angle;
    s.releaseX = s.x;
    var a = angle * Math.PI / 180;
    // 순풍은 조금 더, 역풍은 조금 덜 (속도에 반영)
    var v = s.relV * (1 + 0.006 * s.wind);
    s.jvx = v * Math.cos(a);
    s.jvy = v * Math.sin(a);
    s.jx = s.x + 0.5;
    s.jy = RELEASE_H;
    s.flightT = 0;
    s.throwT = 0;
    s.phase = 'flight';
    s.t = 0;
    SO.sound.sweep(500, 180, 0.5, 'triangle', 0.18);
    SO.sound.noise(0.2, 0.25, 2500);
    SO.vibrate(35);
  }

  // 35° 근처를 넘어가면 창이 떠서 손해 (공기 저항 흉내)
  function aero(angle) {
    return 1 - 0.012 * Math.pow(Math.max(0, angle - BEST_ANGLE), 1.5);
  }

  function land() {
    var a = s.angle;
    // 실제 비행 궤적 대신 공기 저항을 반영한 거리로 착지점 보정
    var vx = s.jvx, vy = s.jvy;
    var tl = (vy + Math.sqrt(vy * vy + 2 * G * RELEASE_H)) / G;
    var ideal = vx * tl;
    var x = s.releaseX + 0.5 + ideal * aero(a);
    var descent = Math.atan2(-(vy - G * tl), vx) * 180 / Math.PI;
    var flat = a > FLAT_ANGLE;
    s.landed = { x: x, angle: flat ? 0 : Math.min(70, descent), flat: flat };
    s.jx = x;
    s.jy = 0;
    s.phase = 'landed';
    s.t = 0;
    s.shake = 0.2;
    SO.sound.noise(0.2, 0.5, 600);
    SO.vibrate([40, 30]);

    var stopX = s.releaseX + stopDist(s.runV);
    if (stopX > LINE_X) {
      s.result = { dist: null, reason: '던진 뒤 선을 밟았어요 (너무 붙어서 던짐)' };
      showBanner('파울!', true);
      SO.sound.beep(140, 0.6, 'sawtooth', 0.22);
    } else if (flat) {
      s.result = { dist: null, reason: '창이 꼬리부터 떨어졌어요 (45° 넘음)' };
      showBanner('파울!', true);
      SO.sound.beep(140, 0.6, 'sawtooth', 0.22);
    } else {
      var d = Math.max(0, Math.floor((x - LINE_X) * 100 + 1e-6) / 100);
      s.result = { dist: d };
      showBanner(fmtDist(d), false);
      if (d >= 80) SO.sound.noise(1.8, 0.3, 2200);
    }
  }

  function foul(reason) {
    s.phase = 'foul';
    s.t = 0;
    s.result = { dist: null, reason: reason };
    showBanner('파울!', true);
    SO.sound.beep(140, 0.6, 'sawtooth', 0.22);
    SO.vibrate([80, 40, 80]);
  }

  // ---- 진행 ----
  function update(dt) {
    s.t += dt;
    s.shake = Math.max(0, s.shake - dt);
    s.stumbleT = Math.max(0, s.stumbleT - dt);
    switch (s.phase) {
      case 'run':
        if (s.planting) break; // 던지는 동작 중에는 제자리
        s.v = Math.max(0, s.v - DRAG * s.v * dt);
        if (s.v < 0.15) s.v = 0;
        s.x += s.v * dt;
        s.stride += s.v * dt;
        if (s.x > LINE_X) foul('던지기 전에 선을 넘었어요');
        else if (s.v === 0 && s.t - s.lastStep > 4) foul('시간 초과');
        break;
      case 'flight':
      case 'landed':
      case 'result': {
        // 선수는 던진 뒤 미끄러지며 멈춤
        if (s.runV > 0) {
          var stopX = s.releaseX + stopDist(s.runV);
          var k = Math.min(1, s.throwT * BRAKE / Math.max(0.1, s.runV));
          s.x = s.releaseX + (stopX - s.releaseX) * (1 - (1 - k) * (1 - k));
        }
        s.throwT += dt;
        if (s.phase === 'flight') {
          s.flightT += dt;
          var t = s.flightT;
          s.jx = s.releaseX + 0.5 + s.jvx * t * aero(s.angle);
          s.jy = RELEASE_H + s.jvy * t - 0.5 * G * t * t;
          if (s.jy <= 0) land();
        } else if (s.phase === 'landed' && s.t > 1.8) showResult();
        break;
      }
      case 'foul':
        s.v = Math.max(0, s.v - 8 * dt);
        s.x += s.v * dt;
        s.stride += s.v * dt;
        if (s.t > 1.6) showResult();
        break;
    }
    var view = W / PPM;
    var target = s.phase === 'flight' || s.phase === 'landed' || (s.phase === 'result' && s.landed)
      ? s.jx - view * 0.55
      : s.x - view * 0.3;
    s.cam += (target - s.cam) * Math.min(1, dt * 4);
    if (s.phase === 'flight') s.cam = Math.max(s.cam, target - view * 0.2); // 빠른 창을 놓치지 않게
    // 창이 높이 뜨면 카메라도 위로 따라감
    var targetY = s.phase === 'flight' ? Math.max(0, s.jy - (GROUND / PPM) * 0.5) : 0;
    if (targetY > s.camY) s.camY = targetY; // 올라갈 땐 바로 따라가고
    else s.camY += (targetY - s.camY) * Math.min(1, dt * 5); // 내려올 땐 부드럽게
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

  function showResult() {
    if (s.phase === 'result') return;
    var hadThrow = s.landed != null;
    s.phase = 'result';
    hideBanner();
    var p = currentPlayer();
    var prevBest = best(p);
    var r = s.result;
    p.marks.push({ dist: r.dist });

    ui.resDist.classList.toggle('foul', r.dist == null);
    ui.resDist.textContent = r.dist == null ? '파울 ✕' : fmtDist(r.dist);
    ui.resBadge.textContent = r.dist != null && r.dist > WORLD_RECORD ? '🌍 세계 신기록!' : '개인 최고!';
    ui.resBadge.classList.toggle('hidden', !(r.dist != null && ((prevBest != null && r.dist > prevBest) || r.dist > WORLD_RECORD)));
    var stats = hadThrow
      ? '투척 ' + (s.relV * 3.6).toFixed(1) + ' km/h · 각도 ' + s.angle.toFixed(1) + '° · 도움닫기 ' + (s.runV * 3.6).toFixed(1) + ' km/h'
      : '';
    ui.resDetail.textContent = r.dist == null ? r.reason + (stats ? ' · ' + stats : '') : stats;
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

  var lastHud = '';
  function updateHud() {
    var thrown = s.angle != null;
    var v = thrown ? s.relV : s.v;
    var remain = LINE_X - s.x;
    var stopRemain = LINE_X - (s.x + stopDist(s.v));
    var running = s.phase === 'run';
    var lineText = running ? (stopRemain < 0 ? '지금 던지면 선 밟음!' : '선까지 ' + Math.max(0, remain).toFixed(1) + ' m') : '';
    var w = s.wind;
    var windText = '바람 ' + (Math.abs(w) < 0.05 ? '0.0' : (w > 0 ? '순풍 → +' : '역풍 ← ') + Math.abs(w).toFixed(1)) + ' m/s';
    var key = [s.phase, v.toFixed(1), thrown ? s.angle.toFixed(1) : '', lineText, windText, s.lastFoot, s.stumbleT > 0].join('|');
    if (key === lastHud) return;
    lastHud = key;
    ui.speed.textContent = (v * 3.6).toFixed(1);
    ui.angle.textContent = thrown ? s.angle.toFixed(1) : '--.-';
    ui.toLine.textContent = lineText;
    ui.toLine.classList.toggle('hidden', !lineText);
    ui.toLine.classList.toggle('danger', running && stopRemain < 0);
    ui.windChip.textContent = windText;
    ui.swipeHint.classList.toggle('hidden', !(running && remain < 14 && stopRemain > 0));
    // 다음에 눌러야 할 발에 테두리
    ui.leftBtn.classList.toggle('next', running && s.lastFoot === 'R');
    ui.rightBtn.classList.toggle('next', running && s.lastFoot === 'L');
    ui.leftBtn.classList.toggle('stumble', s.stumbleT > 0 && s.lastFoot === 'L');
    ui.rightBtn.classList.toggle('stumble', s.stumbleT > 0 && s.lastFoot === 'R');
  }

  // ---- 그리기 ----
  var W = 0, H = 0, DPR = 1, PPM = 30, GROUND = 0;
  function resize() {
    var r = ui.stage.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    ui.canvas.width = Math.round(W * DPR);
    ui.canvas.height = Math.round(H * DPR);
    PPM = Math.min(W / 10, H / 5.5);
    GROUND = H * 0.78;
  }
  window.addEventListener('resize', resize);

  function sx(x) { return (x - s.cam) * PPM; }
  function sy(y) { return G0 - y * PPM; }
  var G0 = 0; // 카메라가 위로 따라갈 때 내려가는 땅 높이 (px)

  function draw(time) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    G0 = GROUND + s.camY * PPM;
    if (s.shake > 0) ctx.translate(0, (Math.random() - 0.5) * 14 * s.shake);
    SO.stadium.draw(ctx, {
      width: W, base: G0, ppm: PPM, cam: s.cam, time: time,
      cheer: s.phase === 'landed' || (s.phase === 'result' && s.result && s.result.dist != null) ? 1 : 0.25,
    });

    // 구름 (창이 높이 날 때 움직임이 느껴지게)
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (var ci = -2; ci < 12; ci++) {
      var cxw = ci * 17 + 6, cyw = 10 + ((ci * 7 + 20) % 3) * 4.5;
      var cpx = sx(cxw), cpy = sy(cyw);
      if (cpx < -PPM * 4 || cpx > W + PPM * 4 || cpy > G0 - PPM * 4) continue;
      ctx.beginPath();
      ctx.arc(cpx, cpy, PPM * 1.1, 0, 6.283);
      ctx.arc(cpx + PPM * 1.2, cpy + PPM * 0.2, PPM * 0.9, 0, 6.283);
      ctx.arc(cpx - PPM * 1.2, cpy + PPM * 0.3, PPM * 0.8, 0, 6.283);
      ctx.fill();
    }

    var groundH = H - G0 + 20;
    // 잔디 + 도움닫기 트랙
    ctx.fillStyle = '#4d7c0f';
    ctx.fillRect(0, G0, W, groundH);
    ctx.fillStyle = '#c2410c';
    ctx.fillRect(sx(-50), G0, sx(LINE_X) - sx(-50), groundH);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(sx(-50), G0 + 2, sx(LINE_X) - sx(-50), 2);
    // 파울 라인 (호)
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(sx(LINE_X) - 3, G0 - 1, 6, groundH);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(sx(LINE_X) - 1.5, G0 - 1, 3, 12);

    // 거리 표시: 잔디 위에 5m마다 선과 큰 숫자 (10m마다 굵게), 라인 기준
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 줄자(라인 아래 40px)와 안 겹치게 아래쪽에, 단 화면 밖으로는 안 나가게
    var paintY = G0 + Math.min(Math.max(80, groundH * 0.7), groundH - 34);
    for (var m = 5; m <= 110; m += 5) {
      var mx = sx(LINE_X + m);
      if (mx < -60 || mx > W + 60) continue;
      var major = m % 10 === 0;
      ctx.fillStyle = major ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.45)';
      ctx.fillRect(mx - (major ? 1.5 : 1), G0, major ? 3 : 2, groundH);
      ctx.font = '900 ' + Math.round(Math.max(16, PPM * (major ? 0.7 : 0.5))) + 'px system-ui, sans-serif';
      ctx.fillStyle = major ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.5)';
      ctx.fillText(m + 'm', mx + PPM * (major ? 0.9 : 0.7), paintY);
    }
    // 도움닫기 트랙: 라인까지 남은 거리 5m마다
    ctx.font = '700 ' + Math.round(Math.max(12, PPM * 0.36)) + 'px system-ui, sans-serif';
    for (var r = 5; r < LINE_X; r += 5) {
      var rx = sx(LINE_X - r);
      if (rx < -30 || rx > W + 30) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(rx - 1, G0 + 4, 2, 10);
      ctx.fillText(r + 'm', rx, paintY);
    }
    var wr = sx(LINE_X + WORLD_RECORD);
    if (wr > -40 && wr < W + 40) {
      ctx.fillStyle = '#fde047';
      ctx.fillRect(wr - 1.5, G0 - PPM * 0.6, 3, PPM * 0.6 + groundH);
      ctx.font = '800 ' + Math.round(Math.max(11, PPM * 0.3)) + 'px system-ui, sans-serif';
      ctx.fillText('WR ' + WORLD_RECORD, wr, G0 - PPM * 0.8);
    }

    // 선수별 최고 기록 깃발
    match.players.forEach(function (pl) {
      var b = best(pl);
      if (b == null) return;
      var fx = sx(LINE_X + b);
      if (fx < -20 || fx > W + 20) return;
      ctx.fillStyle = '#334155';
      ctx.fillRect(fx - 1, G0 - PPM * 0.9, 2, PPM * 0.9);
      ctx.fillStyle = pl.color;
      ctx.beginPath();
      ctx.moveTo(fx + 1, G0 - PPM * 0.9);
      ctx.lineTo(fx + PPM * 0.45, G0 - PPM * 0.78);
      ctx.lineTo(fx + 1, G0 - PPM * 0.66);
      ctx.fill();
    });

    // 지금 던지면 멈추는 곳 (트랙 위 표시)
    if (s.phase === 'run' && s.v > 0.5) {
      var stopX = s.x + stopDist(s.v);
      var bad = stopX > LINE_X;
      ctx.fillStyle = bad ? 'rgba(239,68,68,0.35)' : 'rgba(253,224,71,0.3)';
      ctx.fillRect(sx(s.x), G0 + 6, (stopX - s.x) * PPM, 10);
      ctx.fillStyle = bad ? '#ef4444' : '#fde047';
      ctx.fillRect(sx(stopX) - 2, G0 - 4, 4, 22);
      ctx.font = '700 ' + Math.round(Math.max(11, PPM * 0.28)) + 'px system-ui, sans-serif';
      ctx.fillText('멈추는 곳', sx(stopX), G0 + 30);
    }

    drawAthlete(currentPlayer().color, time);

    // 창
    if (s.phase === 'flight') {
      var t = s.flightT;
      var ang = Math.atan2(s.jvy - G * t, s.jvx);
      if (s.angle > FLAT_ANGLE) ang = Math.max(ang, s.angle * Math.PI / 180 * (1 - t / 4)); // 높게 던지면 머리를 못 숙임
      drawJavelin(s.jx, s.jy, ang, 0.45);
      // 그림자
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(sx(s.jx) - PPM * 1.1, G0 + 1, PPM * 2.2, 3);
    } else if (s.landed && (s.phase === 'landed' || s.phase === 'result')) {
      var la = s.landed.flat ? 0 : -s.landed.angle * Math.PI / 180;
      // 끝이 땅에 꽂힘: 꽂힌 점이 끝(tip)
      drawJavelin(s.landed.x, s.landed.flat ? 0.03 : 0, la, s.landed.flat ? 0.5 : 0.95);
      if (s.result && s.result.dist != null && s.t > 0.3) {
        var y0 = G0 + 40;
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(sx(LINE_X), y0); ctx.lineTo(sx(s.landed.x), y0);
        ctx.moveTo(sx(s.landed.x), y0 - 7); ctx.lineTo(sx(s.landed.x), y0 + 7);
        ctx.stroke();
        ctx.fillStyle = '#fde047';
        ctx.font = '800 ' + Math.round(Math.max(14, PPM * 0.5)) + 'px system-ui, sans-serif';
        ctx.fillText(fmtDist(s.result.dist), Math.max(60, Math.min(W - 60, sx(s.landed.x) - PPM * 2)), y0 + 22);
      }
    }
  }

  // 창 그리기: (x, y)가 창의 tipAt 지점 (0 = 꼬리, 1 = 끝)
  function drawJavelin(x, y, ang, tipAt) {
    var cx = Math.cos(ang), cy = Math.sin(ang);
    var tx = x + cx * JAV_LEN * (1 - tipAt), ty = y + cy * JAV_LEN * (1 - tipAt);
    var bx = x - cx * JAV_LEN * tipAt, by = y - cy * JAV_LEN * tipAt;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = Math.max(3.5, PPM * 0.07);
    ctx.beginPath();
    ctx.moveTo(sx(bx), sy(by));
    ctx.lineTo(sx(tx), sy(ty));
    ctx.stroke();
    // 손잡이 감은 부분 + 쇠촉
    var gx = bx + cx * JAV_LEN * 0.42, gy = by + cy * JAV_LEN * 0.42;
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = Math.max(4, PPM * 0.08);
    ctx.beginPath();
    ctx.moveTo(sx(gx), sy(gy));
    ctx.lineTo(sx(gx + cx * 0.3), sy(gy + cy * 0.3));
    ctx.stroke();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = Math.max(3, PPM * 0.06);
    ctx.beginPath();
    ctx.moveTo(sx(tx - cx * 0.25), sy(ty - cy * 0.25));
    ctx.lineTo(sx(tx), sy(ty));
    ctx.stroke();
  }

  function drawAthlete(color, time) {
    var pose;
    var carrying = s.phase === 'intro' || s.phase === 'run' || (s.phase === 'foul' && s.angle == null);
    if (carrying) {
      pose = s.v > 0.2 ? SO.athlete.runPose(s.stride, Math.min(1, s.v / 6), 0) : SO.athlete.standPose();
      pose.arms[0] = [3.7, 3.3]; // 창을 어깨 위로 들고 뒤로 뺀 팔
    } else {
      // 던진 직후: 팔을 던진 방향으로 뻗고 몸이 앞으로 쏠림
      var a = (s.angle == null ? 35 : s.angle) * Math.PI / 180;
      var k = Math.min(1, s.throwT / 0.35);
      var reach = Math.PI / 2 + a;
      pose = {
        hip: 0.92 - 0.1 * k, lean: 0.1 + 0.45 * k,
        legs: [[0.6 - 0.3 * k, 0.3], [-0.6 + 0.5 * k, -0.9]],
        arms: [[reach - 0.6 * k, reach - 0.8 * k], [-0.8, -0.5]],
      };
    }
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(sx(s.x), G0 + 2, PPM * 0.35, 4, 0, 0, 6.283);
    ctx.fill();
    SO.athlete.draw(ctx, pose, { x: s.x, y: 0, toX: sx, toY: sy, ppm: PPM, color: color });
    if (carrying) {
      // 손 위치에서 창을 앞쪽으로 살짝 들어 올린 채 들고 감
      var sh = [s.x + Math.sin(pose.lean) * 0.5, pose.hip + Math.cos(pose.lean) * 0.5];
      var el = [sh[0] + Math.sin(pose.arms[0][0]) * 0.3, sh[1] - Math.cos(pose.arms[0][0]) * 0.3];
      var hd = [el[0] + Math.sin(pose.arms[0][1]) * 0.28, el[1] - Math.cos(pose.arms[0][1]) * 0.28];
      drawJavelin(hd[0], hd[1], 0.12, 0.42);
    }
  }

  // ---- 메인 루프 ----
  var prev = 0;
  function frame(time) {
    var dt = Math.min(0.05, (time - prev) / 1000 || 0);
    prev = time;
    if (match && s && !ui.game.classList.contains('hidden')) {
      if (s.phase !== 'intro') update(dt);
      updateHud();
      draw(time);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 테스트/디버그용
  window.Javelin = {
    state: function () { return s; },
    match: function () { return match; },
    stopDist: stopDist,
    constants: { LINE_X: LINE_X },
  };

  SO.registerSW('../../sw.js');
  startSetup();
})();
