/*
 * 투포환 (회전 투법)
 *
 * 1. 원판에 손가락을 대고 원을 그리면 선수가 회전 → 빠르게 돌릴수록 파워 상승
 *    (2바퀴는 돌아야 몸이 다 감김, 3바퀴를 넘기면 서클 밖으로 나가 파울)
 * 2. 마지막에 휙 튕기며 손을 떼면 투척. 손을 떼기 직전 0.1초 동안 손가락이 움직인 방향 = 투척 각도,
 *    튕기는 속도만큼 파워 보너스
 * 3. 공은 높이 2.1m에서 포물선으로 날아감. 기록은 스톱보드부터 (cm 아래 버림)
 */
(function () {
  'use strict';

  // ---- 튜닝 값 ----
  var MAX_TURNS = 3;        // 이보다 많이 돌면 파울
  var FULL_WIND = 2;        // 이만큼 돌아야 파워 100% 가능
  var SPIN_FULL = 2.2;      // 초당 이만큼 돌리면 회전 파워 100% (바퀴/초)
  var V_MIN = 6;            // 제자리에서 툭 던졌을 때 속도 (m/s)
  var V_GAIN = 8.2;         // 파워 100%일 때 더해지는 속도 → 최고 약 14.6 m/s (세계기록급)
  var RELEASE_H = 2.1;      // 손을 떠나는 높이 (m)
  var RELEASE_X = 0.3;      // 스톱보드 앞으로 뻗는 거리 (m)
  var CIRCLE_D = 2.135;     // 서클 지름 (m)
  var FLICK_WINDOW = 100;   // 투척 방향을 재는 시간 (ms)
  var FLICK_MIN = 250;      // 이보다 느리게 떼면 놓친 것 (px/s)
  var WORLD_RECORD = 23.56;
  var G = 9.81;
  var SLOWMO = 0.8;

  var SO = window.SO;
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    setup: $('setup'), game: $('game'), final: $('final'),
    hudDot: $('hudDot'), hudName: $('hudName'), hudAttempt: $('hudAttempt'), hudBest: $('hudBest'),
    stage: $('stage'), canvas: $('canvas'),
    speed: $('speed'), angle: $('angle'), banner: $('banner'),
    power: $('power'), powerFill: $('powerFill'), turns: $('turns'),
    intro: $('intro'), introTurn: $('introTurn'), introName: $('introName'), introGo: $('introGo'),
    result: $('result'), resDist: $('resDist'), resBadge: $('resBadge'), resDetail: $('resDetail'),
    resTable: $('resTable'), resNext: $('resNext'),
    spinPad: $('spinPad'), spinDot: $('spinDot'), padText: $('padText'), padSub: $('padSub'),
    finalTable: $('finalTable'), againBtn: $('againBtn'), setupBtn: $('setupBtn'),
  };
  var ctx = ui.canvas.getContext('2d');

  // ---- 경기 진행 상태 ----
  var match = null;   // { players: [{name,color,marks:[]}], attempts, turn }
  var s = null;       // 현재 시기 상태

  function currentPlayer() { return match.players[match.turn % match.players.length]; }
  function currentRound() { return Math.floor(match.turn / match.players.length) + 1; }
  function totalTurns() { return match.players.length * match.attempts; }

  function newAttempt() {
    s = {
      phase: 'intro',     // intro → ready → spin → flight → landed | foul → result
      t: 0,
      accum: 0,           // 손가락이 돈 각도 합 (rad, 방향 포함)
      omega: 0,           // 회전 속도 (rad/s, 부드럽게)
      omegaHist: [],      // [시각, omega]
      lastMove: 0,
      lastAngle: null,
      halfTurns: 0,
      points: [],         // 손가락 경로 [{x,y,t}]
      v: 0, angle: null, power: 0,
      bx: 0, by: 0, vx: 0, vy: 0, flightT: 0,
      markX: null,
      result: null,
      cam: 0,
      throwT: 0,
      shake: 0,
    };
  }

  function turns() { return Math.abs(s.accum) / (2 * Math.PI); }
  // 회전 수에 따른 몸 감김 정도 (제자리 투척은 절반 정도의 힘)
  function windFactor(n) {
    if (n < 0.5) return 0.55;
    if (n < FULL_WIND) return 0.55 + 0.45 * (n - 0.5) / (FULL_WIND - 0.5);
    return 1;
  }
  function spinPower(omega) { return Math.min(1, omega / (SPIN_FULL * 2 * Math.PI)); }
  function powerNow() { return spinPower(s.omega) * windFactor(turns()); }

  // ---- 화면 전환 ----
  function show(el) {
    [ui.setup, ui.game, ui.final].forEach(function (x) { x.classList.toggle('hidden', x !== el); });
  }

  function startSetup() {
    show(ui.setup);
    SO.setupPlayers(ui.setup, {
      title: '💪 투포환',
      storageKey: 'shotput',
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
    s.cam = -viewWidthM() * 0.3;
    updateHud();
  }

  ui.introGo.addEventListener('click', function () {
    SO.enterGameMode();
    ui.intro.classList.add('hidden');
    s.phase = 'ready';
  });

  // ---- 입력: 원 그리기 → 휙 튕기며 떼기 ----
  var pointerId = null;
  function padCenter() {
    var r = ui.spinPad.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  ui.spinPad.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (s.phase !== 'ready' || pointerId != null) return;
    try { ui.spinPad.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    pointerId = e.pointerId;
    s.phase = 'spin';
    s.t = 0;
    var c = padCenter();
    s.lastAngle = Math.atan2(e.clientY - c.y, e.clientX - c.x);
    s.lastMove = e.timeStamp;
    s.points = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
    SO.vibrate(10);
  });

  ui.spinPad.addEventListener('pointermove', function (e) {
    if (e.pointerId !== pointerId || s.phase !== 'spin') return;
    var c = padCenter();
    var dx = e.clientX - c.x, dy = e.clientY - c.y;
    var tNow = e.timeStamp;
    s.points.push({ x: e.clientX, y: e.clientY, t: tNow });
    if (s.points.length > 60) s.points.shift();
    if (Math.hypot(dx, dy) < 20) return; // 가운데 근처는 각도가 튀어서 무시
    var a = Math.atan2(dy, dx);
    var d = a - s.lastAngle;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    var dt = Math.max(0.004, (tNow - s.lastMove) / 1000);
    s.accum += d;
    var inst = Math.abs(d) / dt;
    var k = Math.min(1, dt / 0.25);
    s.omega += (inst - s.omega) * k;
    s.lastAngle = a;
    s.lastMove = tNow;
    s.omegaHist.push([tNow, s.omega]);
    if (s.omegaHist.length > 80) s.omegaHist.shift();
    ui.spinDot.style.left = (50 + 50 * Math.cos(a)) + '%';
    ui.spinDot.style.top = (50 + 50 * Math.sin(a)) + '%';

    // 반 바퀴마다 '휙' 소리와 진동 — 빨리 돌릴수록 높은 소리
    var half = Math.floor(turns() * 2);
    if (half > s.halfTurns) {
      s.halfTurns = half;
      SO.sound.sweep(160 + powerNow() * 300, 260 + powerNow() * 500, 0.12, 'triangle', 0.08);
      SO.vibrate(8 + Math.round(powerNow() * 14));
    }
    if (turns() > MAX_TURNS) foul('서클 밖으로 나갔어요');
  });

  ['pointerup', 'pointercancel'].forEach(function (ev) {
    ui.spinPad.addEventListener(ev, function (e) {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      if (s.phase === 'spin') release(e.timeStamp);
    });
  });
  document.addEventListener('contextmenu', function (e) { if (!ui.game.classList.contains('hidden')) e.preventDefault(); });

  function release(tUp) {
    var pts = s.points;
    var last = pts[pts.length - 1];
    var first = last;
    for (var i = pts.length - 1; i >= 0; i--) {
      first = pts[i];
      if (last.t - pts[i].t >= FLICK_WINDOW) break;
    }
    var dt = Math.max(0.016, (last.t - first.t) / 1000);
    var fx = last.x - first.x, fy = last.y - first.y;
    var flickSpeed = Math.hypot(fx, fy) / dt;
    var angle = Math.atan2(-fy, fx) * 180 / Math.PI;

    // 튕기기 직전의 회전 속도로 파워 계산 (튕기는 동작 자체는 원이 아니라서)
    var omega = s.omega;
    for (var j = s.omegaHist.length - 1; j >= 0; j--) {
      if (tUp - s.omegaHist[j][0] >= 150) { omega = s.omegaHist[j][1]; break; }
    }
    var power = spinPower(omega) * windFactor(turns());
    var bonus = 0.85 + 0.2 * Math.max(0, Math.min(1, (flickSpeed - 600) / 1800));
    s.power = power;
    s.angle = angle;
    s.v = V_MIN + V_GAIN * power * bonus;

    if (flickSpeed < FLICK_MIN) return foul('공을 놓쳤어요 (휙 튕기며 떼세요)');
    if (angle > 90 || angle < -150) return foul('뒤로 던졌어요');
    if (angle < -30) return foul('땅으로 내리꽂았어요');

    var a = angle * Math.PI / 180;
    s.vx = s.v * Math.cos(a);
    s.vy = s.v * Math.sin(a);
    s.bx = RELEASE_X;
    s.by = RELEASE_H;
    s.flightT = 0;
    s.phase = 'flight';
    s.t = 0;
    s.throwT = 0;
    SO.sound.noise(0.25, 0.35, 900);
    SO.sound.beep(120, 0.2, 'sawtooth', 0.12);
    SO.vibrate(40);
  }

  function land() {
    var raw = s.bx;
    s.markX = raw;
    s.phase = 'landed';
    s.t = 0;
    s.shake = 0.3;
    SO.sound.noise(0.35, 0.7, 300);
    SO.vibrate([50, 30, 30]);
    var d = Math.floor(raw * 100 + 1e-6) / 100;
    s.result = { dist: d };
    showBanner(fmtDist(d), false);
    if (d >= 20) SO.sound.noise(1.8, 0.3, 2200);
  }

  function foul(reason) {
    pointerId = null;
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
    switch (s.phase) {
      case 'spin':
        // 손가락이 멈추면 회전 속도도 줄어듦
        if (performance.now() - s.lastMove > 60) s.omega *= Math.exp(-dt * 4);
        break;
      case 'flight': {
        s.throwT += dt;
        s.flightT += dt * SLOWMO;
        var t = s.flightT;
        s.bx = RELEASE_X + s.vx * t;
        s.by = RELEASE_H + s.vy * t - 0.5 * G * t * t;
        if (s.by <= 0) {
          // 땅에 닿은 정확한 지점
          var disc = s.vy * s.vy + 2 * G * RELEASE_H;
          var tl = (s.vy + Math.sqrt(disc)) / G;
          s.bx = RELEASE_X + s.vx * tl;
          s.by = 0;
          land();
        }
        break;
      }
      case 'landed':
        if (s.t > 1.8) showResult();
        break;
      case 'foul':
        if (s.t > 1.6) showResult();
        break;
    }
    var view = viewWidthM();
    var target = s.phase === 'flight' || s.phase === 'landed' || (s.phase === 'result' && s.markX != null)
      ? Math.max(-view * 0.3, s.bx - view * 0.55)
      : -view * 0.3;
    s.cam += (target - s.cam) * Math.min(1, dt * 4);
  }

  // ---- 결과 / 순위 (멀리뛰기와 같은 규칙: 최고 기록 → 두 번째 기록 …) ----
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
    var stats = '속도 ' + (s.v * 3.6).toFixed(1) + ' km/h · 각도 ' + (s.angle == null ? '--.-' : s.angle.toFixed(1)) + '° · 회전 ' + turns().toFixed(1) + '바퀴';
    ui.resDetail.textContent = r.dist == null ? r.reason : stats;
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
    var thrown = s.angle != null && s.phase !== 'spin';
    var spinning = s.phase === 'spin';
    var p = spinning ? powerNow() : thrown ? s.power : 0;
    var v = thrown ? s.v : spinning ? V_MIN + V_GAIN * p : 0;
    var n = turns();
    var key = [s.phase, v.toFixed(1), thrown ? s.angle.toFixed(1) : '', Math.round(p * 100), n.toFixed(1)].join('|');
    if (key === lastHud) return;
    lastHud = key;
    ui.speed.textContent = (v * 3.6).toFixed(1);
    ui.angle.textContent = thrown ? s.angle.toFixed(1) : '--.-';
    ui.powerFill.style.width = Math.round(p * 100) + '%';
    ui.turns.textContent = '회전 ' + n.toFixed(1) + ' / ' + MAX_TURNS;
    ui.turns.parentNode.classList.toggle('danger', n > MAX_TURNS - 0.5);
    ui.spinPad.classList.toggle('active', spinning);
    ui.padText.textContent = spinning ? (n < FULL_WIND ? '계속 돌려요!' : '지금 ↗ 휙!') : '↻ 원을 그리다가 ↗ 휙!';
    ui.padSub.textContent = spinning ? '빠를수록 파워 ↑ · 3바퀴 넘으면 파울' : '손가락을 대고 빙글빙글';
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
    PPM = Math.min(W / 7.5, H / 6);
    GROUND = H * 0.78;
  }
  window.addEventListener('resize', resize);

  function sx(x) { return (x - s.cam) * PPM; }
  function sy(y) { return GROUND - y * PPM; }

  function draw(time) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (s.shake > 0) ctx.translate(0, (Math.random() - 0.5) * 16 * s.shake);
    SO.stadium.draw(ctx, {
      width: W, base: GROUND, ppm: PPM, cam: s.cam, time: time,
      cheer: s.phase === 'landed' || (s.phase === 'result' && s.markX != null) ? 1 : 0.25,
    });

    // 바닥: 잔디 (투척 구역) + 서클 (콘크리트)
    var groundH = H - GROUND + 20;
    ctx.fillStyle = '#4d7c0f';
    ctx.fillRect(0, GROUND, W, groundH);
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(sx(-CIRCLE_D - 0.5), GROUND, (CIRCLE_D + 0.5) * PPM, groundH);
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(sx(-CIRCLE_D), GROUND, CIRCLE_D * PPM, 5);
    // 스톱보드
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(sx(0), GROUND - 0.1 * PPM, 0.11 * PPM, 0.1 * PPM + 4);

    // 1m 눈금, 5m마다 숫자
    ctx.font = '700 ' + Math.round(Math.max(12, PPM * 0.38)) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var m = 1; m <= 26; m++) {
      var mx = sx(m);
      if (mx < -30 || mx > W + 30) continue;
      ctx.fillStyle = m % 5 === 0 ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)';
      ctx.fillRect(mx - 1, GROUND, 2, m % 5 === 0 ? groundH : 10);
      if (m % 5 === 0) ctx.fillText(m + 'm', mx + PPM * 0.45, GROUND + 18);
    }
    // 세계기록 선
    var wr = sx(WORLD_RECORD);
    if (wr > -40 && wr < W + 40) {
      ctx.fillStyle = '#fde047';
      ctx.fillRect(wr - 1.5, GROUND - PPM * 0.6, 3, PPM * 0.6 + groundH);
      ctx.font = '800 ' + Math.round(Math.max(11, PPM * 0.3)) + 'px system-ui, sans-serif';
      ctx.fillText('WR ' + WORLD_RECORD, wr, GROUND - PPM * 0.8);
    }

    // 선수별 최고 기록 깃발
    match.players.forEach(function (pl) {
      var b = best(pl);
      if (b == null) return;
      var fx = sx(b);
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

    // 착지 자국 + 줄자
    if (s.markX != null) {
      ctx.fillStyle = 'rgba(60, 40, 10, 0.55)';
      ctx.beginPath();
      ctx.ellipse(sx(s.markX), GROUND + 3, PPM * 0.25, 5, 0, 0, 6.283);
      ctx.fill();
      if (s.result && s.result.dist != null && s.t > 0.3) {
        var y0 = GROUND + 40;
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(sx(0), y0); ctx.lineTo(sx(s.markX), y0);
        ctx.moveTo(sx(0), y0 - 7); ctx.lineTo(sx(0), y0 + 7);
        ctx.moveTo(sx(s.markX), y0 - 7); ctx.lineTo(sx(s.markX), y0 + 7);
        ctx.stroke();
        ctx.fillStyle = '#fde047';
        ctx.font = '800 ' + Math.round(Math.max(14, PPM * 0.5)) + 'px system-ui, sans-serif';
        var lx = Math.min(W - 60, Math.max(60, (Math.max(0, sx(0)) + sx(s.markX)) / 2));
        ctx.fillText(fmtDist(s.result.dist), lx, y0 + 22);
      }
    }

    drawAthlete(currentPlayer().color);

    // 날아가는 공 (그림자와 궤적)
    if (s.phase === 'flight' || s.phase === 'landed' || (s.phase === 'result' && s.markX != null)) {
      var br = Math.max(5, 0.07 * PPM);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(sx(s.bx), GROUND + 2, br * 1.2, br * 0.4, 0, 0, 6.283);
      ctx.fill();
      if (s.phase === 'flight') {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        for (var tt = 0; tt <= s.flightT; tt += 0.05) {
          var px = sx(RELEASE_X + s.vx * tt), py = sy(RELEASE_H + s.vy * tt - 0.5 * G * tt * tt);
          if (tt === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      drawBall(sx(s.bx), sy(s.by), br);
    }
  }

  function drawBall(x, y, r) {
    var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, '#d1d5db');
    g.addColorStop(1, '#374151');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.283);
    ctx.fill();
  }

  // 선수: 회전 중에는 좌우로 납작해졌다 뒤집히며 도는 것처럼 보이게
  function drawAthlete(color) {
    var n = turns();
    var hipX = -CIRCLE_D + 0.4 + Math.min(n, MAX_TURNS + 0.3) / MAX_TURNS * (CIRCLE_D - 0.7);
    var face = 1;
    var pose;
    var holding = s.phase === 'intro' || s.phase === 'ready' || s.phase === 'spin';
    if (holding) {
      var phi = Math.PI + s.accum; // 던지는 반대쪽을 보고 시작
      face = Math.cos(phi);
      if (Math.abs(face) < 0.15) face = face < 0 ? -0.15 : 0.15;
      pose = {
        hip: 0.88, lean: 0.12,
        legs: [[0.35, -0.15], [-0.3, -0.55]],
        arms: [[1.9, 4.2], [1.7, 1.6]],
      };
    } else if (s.phase === 'foul' && s.angle == null) {
      hipX = -0.1;
      pose = SO.athlete.runPose(s.t * 3, 0.5, 0.2);
    } else {
      // 투척 → 팔을 던진 각도로 쭉 뻗었다가 앞으로 넘어가는 마무리 동작
      hipX = -0.35;
      var a = (s.angle == null ? 40 : s.angle) * Math.PI / 180;
      var k = Math.min(1, (s.phase === 'flight' ? s.throwT : 1) / 0.35);
      var reach = Math.PI / 2 + a;
      pose = {
        hip: 0.92, lean: 0.15 + 0.35 * k,
        legs: [[0.2 - 0.4 * k, -0.1], [-0.5 + 0.9 * k, -0.6 * k]],
        arms: [[reach - 0.3 * k, reach - 0.3 * k], [-0.6, -0.3]],
      };
    }
    var toX = function (x) { return sx(hipX + (x - hipX) * face); };
    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(sx(hipX), GROUND + 2, PPM * 0.35, 4, 0, 0, 6.283);
    ctx.fill();
    SO.athlete.draw(ctx, pose, { x: hipX, y: 0, toX: toX, toY: sy, ppm: PPM, color: color });

    // 목에 댄 공
    if (holding) {
      var sh = [hipX + Math.sin(pose.lean) * 0.5, pose.hip + Math.cos(pose.lean) * 0.5];
      var el = [sh[0] + Math.sin(pose.arms[0][0]) * 0.3, sh[1] - Math.cos(pose.arms[0][0]) * 0.3];
      var hd = [el[0] + Math.sin(pose.arms[0][1]) * 0.28, el[1] - Math.cos(pose.arms[0][1]) * 0.28];
      drawBall(toX(hd[0]), sy(hd[1]), Math.max(5, 0.07 * PPM));
    }
  }

  // ---- 메인 루프 ----
  var prev = 0;
  function frame(time) {
    var dt = Math.min(0.05, (time - prev) / 1000 || 0);
    prev = time;
    if (match && s && !ui.game.classList.contains('hidden')) {
      update(dt);
      updateHud();
      draw(time);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 테스트/디버그용
  window.ShotPut = {
    state: function () { return s; },
    match: function () { return match; },
    turns: function () { return turns(); },
  };

  SO.registerSW('../../sw.js');
  startSetup();
})();
