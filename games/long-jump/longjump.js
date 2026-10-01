/*
 * 멀리뛰기
 *
 * 1. 달리기 버튼을 연타 → 속도 상승 (안 누르면 서서히 감속)
 * 2. 점프 구간에서 점프 버튼을 누르고 있으면 각도가 올라감
 * 3. 손을 떼는 순간의 속도·각도로 점프. 발판 선(파울 라인)을 넘으면 파울
 * 기록 = 착지 지점 - 파울 라인 (실제 경기처럼 cm 아래는 버림)
 */
(function () {
  'use strict';

  // ---- 튜닝 값 ----
  var LINE_X = 40;          // 출발점에서 파울 라인까지 (m)
  var JUMP_ZONE = 12;       // 라인 앞 몇 m부터 점프 버튼이 켜지는지
  var V_MAX = 18;           // 이론상 최고 속도 (m/s) — 다가갈수록 탭 효과가 줄어든다
  var TAP_BOOST = 1.0;      // 한 번 탭할 때 속도 증가 (m/s)
  var DRAG = 0.4;           // 초당 감속 비율
  var ANGLE_RATE = 40;      // 초당 각도 증가 (°)
  var ANGLE_MAX = 80;
  var SPRING = 1.3;         // 발판 반발 (속도 배수)
  var ANGLE_COST = 1.5;     // 각도가 높을수록 속도 손실 → 최적 각도 약 20°
  var LAND_REACH = 0.4;     // 착지 시 다리를 뻗어 얻는 거리 (m)
  var PIT_START = 0.5;      // 모래판 시작 (라인 기준 m)
  var PIT_END = 14;
  var G = 9.81;
  var SLOWMO = 0.6;         // 공중 장면 재생 속도
  var STRIDE = 2.2;         // 달리기 동작 한 주기당 거리 (m)

  var SO = window.SO;
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    setup: $('setup'), game: $('game'), final: $('final'),
    hudDot: $('hudDot'), hudName: $('hudName'), hudAttempt: $('hudAttempt'), hudBest: $('hudBest'),
    stage: $('stage'), canvas: $('canvas'),
    speed: $('speed'), angle: $('angle'), toLine: $('toLine'), banner: $('banner'),
    intro: $('intro'), introTurn: $('introTurn'), introName: $('introName'), introGo: $('introGo'),
    result: $('result'), resDist: $('resDist'), resBadge: $('resBadge'), resDetail: $('resDetail'),
    resTable: $('resTable'), resNext: $('resNext'),
    runBtn: $('runBtn'), jumpBtn: $('jumpBtn'),
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
      phase: 'intro',     // intro → countdown → run → flight → landed | foul → result
      x: 0, y: 0, v: 0,
      stride: 0,
      angle: 0,
      charging: false,
      t: 0,               // 현재 단계 경과 시간
      lastTap: 0,
      takeoffX: 0, takeoffV: 0, takeoffAngle: 0,
      vx: 0, vy: 0, flightT: 0, flightDur: 0,
      markX: null,
      result: null,       // { dist|null, reason }
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
      title: '🏃 멀리뛰기',
      storageKey: 'longjump',
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
    updateMeters();
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
    if (s.phase !== 'run') return;
    s.v += TAP_BOOST * Math.max(0, 1 - s.v / V_MAX);
    s.lastTap = s.t;
    SO.sound.beep(160 + s.v * 14, 0.035, 'square', 0.05);
    SO.vibrate(8);
  }

  function inZone() { return s && s.phase === 'run' && LINE_X - s.x <= JUMP_ZONE; }

  function startCharge() {
    if (s.phase !== 'run' || s.charging) return;
    if (!inZone()) {
      ui.jumpBtn.classList.remove('shake');
      void ui.jumpBtn.offsetWidth;
      ui.jumpBtn.classList.add('shake');
      return;
    }
    s.charging = true;
    s.angle = 0;
    SO.vibrate(15);
  }

  function releaseCharge() {
    if (!s.charging) return;
    s.charging = false;
    if (s.phase === 'run') takeoff();
  }

  function pressFx(btn) {
    btn.classList.add('pressed');
    clearTimeout(btn._t);
    btn._t = setTimeout(function () { btn.classList.remove('pressed'); }, 70);
  }

  // 여러 손가락으로 번갈아 두드려도 매번 인식되도록 pointerdown 사용
  ui.runBtn.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    pressFx(ui.runBtn);
    tap();
  });
  ui.jumpBtn.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    try { ui.jumpBtn.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    startCharge();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) {
    ui.jumpBtn.addEventListener(ev, releaseCharge);
  });
  document.addEventListener('contextmenu', function (e) { if (!ui.game.classList.contains('hidden')) e.preventDefault(); });

  // 키보드 (PC 테스트용): 스페이스/→ = 달리기, ↑ 누르고 있기 = 점프
  document.addEventListener('keydown', function (e) {
    if (!match || ui.game.classList.contains('hidden')) return;
    if ((e.code === 'Space' || e.code === 'ArrowRight') && !e.repeat) { e.preventDefault(); tap(); }
    if (e.code === 'ArrowUp' && !e.repeat) { e.preventDefault(); startCharge(); }
  });
  document.addEventListener('keyup', function (e) {
    if (e.code === 'ArrowUp') releaseCharge();
  });

  // ---- 물리 ----
  function takeoff() {
    var a = s.angle * Math.PI / 180;
    var sin = Math.sin(a);
    var eff = Math.max(0.05, 1 - ANGLE_COST * sin * sin) * SPRING;
    s.takeoffX = s.x;
    s.takeoffV = s.v;
    s.takeoffAngle = s.angle;
    s.vx = s.v * Math.cos(a) * eff;
    s.vy = s.v * sin * eff;
    s.flightDur = 2 * s.vy / G;
    s.flightT = 0;
    s.phase = 'flight';
    s.t = 0;
    SO.sound.sweep(300, 900, 0.35, 'triangle', 0.2);
    SO.vibrate(30);
    showBanner('점프!', false);
  }

  function land() {
    s.markX = s.takeoffX + s.vx * s.flightDur + LAND_REACH;
    s.phase = 'landed';
    s.t = 0;
    s.y = 0;
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
      if (d >= 7) SO.sound.noise(1.6, 0.25, 2200);
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
      case 'run': {
        if (s.t > 0.6 && ui.banner.textContent === '출발!') hideBanner();
        if (s.charging) s.angle = Math.min(ANGLE_MAX, s.angle + ANGLE_RATE * dt);
        s.v = Math.max(0, s.v - DRAG * s.v * dt);
        if (s.v < 0.15) s.v = 0;
        s.x += s.v * dt;
        s.stride += s.v * dt;
        if (s.x > LINE_X) foul('발이 선을 넘었어요');
        else if (s.v === 0 && s.t - s.lastTap > 4) foul('시간 초과');
        break;
      }
      case 'flight': {
        s.flightT += dt * SLOWMO;
        var ft = Math.min(s.flightT, s.flightDur);
        s.x = s.takeoffX + s.vx * ft;
        s.y = s.vy * ft - 0.5 * G * ft * ft;
        if (s.t > 0.5) hideBanner();
        if (s.flightT >= s.flightDur) land();
        break;
      }
      case 'landed': {
        // 다리를 뻗으며 모래에 미끄러져 앉기
        var k = Math.min(1, s.t / 0.25);
        s.x = s.markX - LAND_REACH * (1 - k) + 0.15 * k;
        if (s.t > 1.6) showResult();
        break;
      }
      case 'foul': {
        // 그대로 달려 나가다가 멈춤
        s.v = Math.max(0, s.v - 8 * dt);
        s.x += s.v * dt;
        s.stride += s.v * dt;
        if (s.t > 1.6) showResult();
        break;
      }
    }

    // 카메라: 달릴 땐 선수를 왼쪽에, 날 땐 착지 지점이 보이게
    var view = viewWidthM();
    var lead = s.phase === 'flight' || s.phase === 'landed' ? 0.38 : 0.28;
    var target = s.x - view * lead;
    s.cam += (target - s.cam) * Math.min(1, dt * 6);
  }

  // ---- 결과 / 순위 ----
  function best(p) {
    var b = null;
    p.marks.forEach(function (m) { if (m.dist != null && (b == null || m.dist > b)) b = m.dist; });
    return b;
  }
  function sortedMarks(p) {
    return p.marks.map(function (m) { return m.dist == null ? -1 : m.dist; }).sort(function (a, b) { return b - a; });
  }
  // 최고 기록 → 두 번째 기록 → … 순으로 비교 (실제 규칙)
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
    p.marks.push({ dist: r.dist, speed: s.takeoffV * 3.6, angle: s.takeoffAngle });

    ui.resDist.classList.toggle('foul', r.dist == null);
    ui.resDist.textContent = r.dist == null ? '파울 ✕' : fmtDist(r.dist);
    ui.resBadge.classList.toggle('hidden', !(r.dist != null && prevBest != null && r.dist > prevBest));
    ui.resDetail.textContent = r.dist == null && r.reason !== '모래판에 못 미쳤어요'
      ? r.reason
      : (r.reason ? r.reason + ' · ' : '') + '시속 ' + (s.takeoffV * 3.6).toFixed(1) + ' km/h · 각도 ' + s.takeoffAngle.toFixed(1) + '°';
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
    ui.banner.classList.remove('hidden', 'pop');
    void ui.banner.offsetWidth;
    ui.banner.classList.add('pop');
  }
  function hideBanner() { ui.banner.classList.add('hidden'); }

  var lastMeters = '';
  function updateMeters() {
    var flying = s.phase === 'flight' || s.phase === 'landed' || s.phase === 'result';
    var v = flying ? s.takeoffV : s.v;
    var a = flying ? s.takeoffAngle : s.angle;
    var remain = LINE_X - s.x;
    var zone = inZone();
    var lineText = s.phase === 'run' || s.phase === 'countdown' || s.phase === 'intro'
      ? (zone ? '점프 구간! ' : '선까지 ') + Math.max(0, remain).toFixed(1) + ' m'
      : '';
    var key = v.toFixed(1) + '|' + a.toFixed(1) + '|' + lineText + zone + s.charging;
    if (key === lastMeters) return;
    lastMeters = key;
    ui.speed.textContent = (v * 3.6).toFixed(1);
    ui.angle.textContent = a.toFixed(1);
    ui.toLine.textContent = lineText;
    ui.toLine.classList.toggle('hidden', !lineText);
    ui.toLine.classList.toggle('zone', zone);
    ui.jumpBtn.classList.toggle('ready', zone && !s.charging);
    ui.jumpBtn.classList.toggle('holding', s.charging);
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

  // 관중석 (한 번만 만들어 반복해서 그림)
  var CROWD_LEN = 24;
  var crowd = [];
  (function () {
    var colors = ['#ef4444', '#3b82f6', '#facc15', '#22c55e', '#f8fafc', '#a855f7', '#fb923c', '#0ea5e9', '#f472b6'];
    for (var row = 0; row < 7; row++) {
      for (var x = 0; x < CROWD_LEN; x += 0.55) {
        if (Math.random() < 0.12) continue;
        crowd.push({ x: x + Math.random() * 0.2, row: row, c: colors[(Math.random() * colors.length) | 0], b: Math.random() * 6.28 });
      }
    }
  })();

  function sx(x) { return (x - s.cam) * PPM; }
  function sy(y) { return GROUND - y * PPM; }

  function draw(time) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var shake = s.shake > 0 ? (Math.random() - 0.5) * 6 * s.shake * 4 : 0;
    ctx.translate(0, shake);

    // 하늘
    var sky = ctx.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, '#5aa9e6');
    sky.addColorStop(1, '#bfe3ff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, -10, W, GROUND + 10);

    // 관중석 (원근감을 위해 천천히 움직임)
    var standTop = GROUND - PPM * 3.4;
    var standBottom = GROUND - PPM * 0.9;
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, standTop, W, standBottom - standTop);
    var par = 0.5;
    var rowH = (standBottom - standTop) / 7;
    var offset = s.cam * par;
    var startRep = Math.floor(offset / CROWD_LEN) - 1;
    var cheer = s.phase === 'landed' || s.phase === 'result' ? 1 : 0.25;
    for (var rep = startRep; rep <= startRep + Math.ceil(viewWidthM() / CROWD_LEN) + 2; rep++) {
      for (var i = 0; i < crowd.length; i++) {
        var c = crowd[i];
        var px = (rep * CROWD_LEN + c.x - offset) * PPM;
        if (px < -10 || px > W + 10) continue;
        var bob = Math.sin(time / 120 + c.b) * cheer * rowH * 0.18;
        var py = standTop + rowH * (c.row + 0.55) + bob;
        ctx.fillStyle = c.c;
        ctx.beginPath();
        ctx.arc(px, py, rowH * 0.32, 0, 6.283);
        ctx.fill();
      }
    }
    // 광고판
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(0, standBottom, W, GROUND - standBottom);
    ctx.fillStyle = '#fbbf24';
    ctx.font = '700 ' + Math.round((GROUND - standBottom) * 0.5) + 'px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (var ax = Math.floor(s.cam / 8) * 8; ax < s.cam + viewWidthM() + 8; ax += 8) {
      ctx.fillText('SUMMER OLYMPIC', sx(ax), (standBottom + GROUND) / 2);
    }

    // 땅 (트랙 / 모래판 / 잔디)
    var groundH = H - GROUND + 20;
    ctx.fillStyle = '#4d7c0f';
    ctx.fillRect(0, GROUND, W, groundH);
    ctx.fillStyle = '#c2410c';
    ctx.fillRect(sx(-50), GROUND, sx(LINE_X + PIT_START) - sx(-50), groundH);
    // 점프 구간 표시
    ctx.fillStyle = 'rgba(255, 210, 80, 0.28)';
    ctx.fillRect(sx(LINE_X - JUMP_ZONE), GROUND, sx(LINE_X) - sx(LINE_X - JUMP_ZONE), groundH);
    // 트랙 레인 줄
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(sx(-50), GROUND + 2, sx(LINE_X + PIT_START) - sx(-50), 2);
    ctx.fillRect(sx(-50), H - 6, sx(LINE_X + PIT_START) - sx(-50), 2);
    // 남은 거리 표시
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 ' + Math.round(PPM * 0.4) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (var m = 5; m < LINE_X; m += 5) {
      var mx = LINE_X - m;
      ctx.fillRect(sx(mx) - 1, GROUND + 4, 2, 10);
      ctx.fillText(m + 'm', sx(mx), GROUND + 26);
    }
    // 모래판
    ctx.fillStyle = '#e9c46a';
    ctx.fillRect(sx(LINE_X + PIT_START), GROUND - 2, sx(LINE_X + PIT_END) - sx(LINE_X + PIT_START), groundH);
    ctx.fillStyle = '#d4a94f';
    ctx.fillRect(sx(LINE_X + PIT_START), GROUND - 2, sx(LINE_X + PIT_END) - sx(LINE_X + PIT_START), 3);
    // 거리 눈금
    ctx.fillStyle = 'rgba(80,50,10,0.75)';
    for (var d = 1; d < PIT_END; d++) {
      ctx.fillRect(sx(LINE_X + d) - 1, GROUND + 2, 2, d % 5 === 0 ? 16 : 9);
      ctx.fillText(d + '', sx(LINE_X + d), GROUND + 30);
    }
    // 발판 + 파울 라인
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(sx(LINE_X - 0.2), GROUND - 1, 0.2 * PPM, 8);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(sx(LINE_X), GROUND - 2, Math.max(3, 0.06 * PPM), 9);

    // 선수별 최고 기록 깃발
    match.players.forEach(function (p) {
      var b = best(p);
      if (b == null) return;
      var fx = sx(LINE_X + b);
      if (fx < -20 || fx > W + 20) return;
      ctx.fillStyle = '#334155';
      ctx.fillRect(fx - 1, GROUND - PPM * 0.9, 2, PPM * 0.9);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(fx + 1, GROUND - PPM * 0.9);
      ctx.lineTo(fx + PPM * 0.45, GROUND - PPM * 0.78);
      ctx.lineTo(fx + 1, GROUND - PPM * 0.66);
      ctx.fill();
    });

    // 착지 자국 + 줄자
    if (s.markX != null) {
      ctx.fillStyle = 'rgba(120, 80, 20, 0.5)';
      ctx.beginPath();
      ctx.ellipse(sx(s.markX), GROUND + 3, PPM * 0.3, 5, 0, 0, 6.283);
      ctx.fill();
      if (s.result && s.result.dist != null && s.t > 0.3) {
        var y0 = GROUND + 44;
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(sx(LINE_X), y0);
        ctx.lineTo(sx(s.markX), y0);
        ctx.moveTo(sx(LINE_X), y0 - 7); ctx.lineTo(sx(LINE_X), y0 + 7);
        ctx.moveTo(sx(s.markX), y0 - 7); ctx.lineTo(sx(s.markX), y0 + 7);
        ctx.stroke();
        ctx.fillStyle = '#fde047';
        ctx.font = '800 ' + Math.round(PPM * 0.5) + 'px system-ui, sans-serif';
        ctx.fillText(fmtDist(s.result.dist), (sx(LINE_X) + sx(s.markX)) / 2, y0 + 22);
      }
    }

    // 그림자
    var shadowScale = Math.max(0.3, 1 - s.y / 3);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(sx(s.x), GROUND + 2, PPM * 0.35 * shadowScale, 4 * shadowScale, 0, 0, 6.283);
    ctx.fill();

    // 속도선
    if ((s.phase === 'run' || s.phase === 'flight') && s.v > 7) {
      ctx.strokeStyle = 'rgba(255,255,255,' + Math.min(0.6, (s.v - 7) / 6) + ')';
      ctx.lineWidth = 2;
      for (var k = 0; k < 4; k++) {
        var ly = sy(s.y + 0.4 + k * 0.35);
        var lx = sx(s.x) - PPM * (0.6 + ((time / 40 + k * 7) % 10) / 10);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx - PPM * 0.8, ly);
        ctx.stroke();
      }
    }

    drawRunner(currentPlayer().color);

    // 점프 각도 화살표
    if (s.charging) {
      var a = s.angle * Math.PI / 180;
      var ox = sx(s.x) + PPM * 0.2, oy = GROUND - 2;
      var len = PPM * 1.8;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ox, oy, len * 0.6, -a, 0);
      ctx.stroke();
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

  // 막대 인형 선수. 각도는 '아래 방향 = 0', 앞쪽(+x)으로 돌수록 +
  function drawRunner(color) {
    var phase = s.phase;
    var pose;
    if (phase === 'flight') {
      var f = s.flightDur > 0 ? Math.min(1, s.flightT / s.flightDur) : 1;
      pose = {
        hip: 0.95, lean: -0.15 + f * 0.35,
        legs: [[0.4 + f * 1.1, 0.1 + f * 1.4], [0.9 + f * 0.6, 0.6 + f * 0.9]],
        arms: [[2.9 - f * 1.6, 2.9 - f * 1.4], [2.6 - f * 1.4, 2.7 - f * 1.2]],
      };
    } else if ((phase === 'landed' || phase === 'result') && s.markX != null) {
      var k = phase === 'result' ? 1 : Math.min(1, s.t / 0.25);
      pose = {
        hip: 0.95 - 0.62 * k, lean: 0.2 + 0.35 * k,
        legs: [[1.5, 1.55], [1.4, 1.5]],
        arms: [[1.3, 1.5], [1.1, 1.3]],
      };
    } else if (phase === 'run' || phase === 'foul') {
      var p = s.stride / STRIDE * Math.PI * 2;
      var amp = Math.min(1, s.v / 6);
      var leg = function (ph) {
        var th = Math.sin(ph) * 0.85 * amp;
        var knee = (0.25 + 1.2 * Math.max(0, Math.cos(ph))) * amp;
        return [th, th - knee];
      };
      var arm = function (ph) {
        var up = -Math.sin(ph) * 0.9 * amp;
        return [up, up + 1.4 * amp + 0.1];
      };
      pose = {
        hip: 0.95 - Math.abs(Math.cos(p)) * 0.04 * amp, lean: 0.05 + 0.2 * amp + (s.charging ? -0.12 : 0),
        legs: [leg(p), leg(p + Math.PI)],
        arms: [arm(p + Math.PI), arm(p)],
      };
    } else {
      pose = { hip: 0.95, lean: 0, legs: [[0.05, 0.05], [-0.05, -0.05]], arms: [[0.15, 0.3], [-0.1, 0.05]] };
    }

    var hx = s.x, hy = s.y + pose.hip;
    var seg = function (x, y, a, len) { return [x + Math.sin(a) * len, y - Math.cos(a) * len]; };
    var line = function (pts, w, col) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w * PPM;
      ctx.beginPath();
      ctx.moveTo(sx(pts[0][0]), sy(pts[0][1]));
      for (var i = 1; i < pts.length; i++) ctx.lineTo(sx(pts[i][0]), sy(pts[i][1]));
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var sh = [hx + Math.sin(pose.lean) * 0.5, hy + Math.cos(pose.lean) * 0.5];
    var head = [hx + Math.sin(pose.lean) * 0.7, hy + Math.cos(pose.lean) * 0.7];

    function limb(origin, angles, l1, l2, col, w) {
      var j = seg(origin[0], origin[1], angles[0], l1);
      var e = seg(j[0], j[1], angles[1], l2);
      line([origin, j, e], w, col);
    }
    // 뒤쪽 팔다리 (어둡게)
    limb([hx, hy], pose.legs[1], 0.46, 0.46, '#b07d5a', 0.11);
    limb(sh, pose.arms[1], 0.3, 0.28, '#b07d5a', 0.08);
    // 몸통 (유니폼)
    line([[hx, hy], sh], 0.2, color);
    // 반바지
    ctx.fillStyle = '#1f2937';
    ctx.beginPath();
    ctx.arc(sx(hx), sy(hy), 0.12 * PPM, 0, 6.283);
    ctx.fill();
    // 앞쪽 팔다리
    limb([hx, hy], pose.legs[0], 0.46, 0.46, '#e6b38c', 0.12);
    limb(sh, pose.arms[0], 0.3, 0.28, '#e6b38c', 0.085);
    // 머리
    ctx.fillStyle = '#e6b38c';
    ctx.beginPath();
    ctx.arc(sx(head[0]), sy(head[1]), 0.13 * PPM, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = '#1f2937';
    ctx.beginPath();
    ctx.arc(sx(head[0]) - 0.03 * PPM, sy(head[1]) - 0.03 * PPM, 0.13 * PPM, Math.PI * 0.9, Math.PI * 2.05);
    ctx.fill();
  }

  // ---- 메인 루프 ----
  var prev = 0;
  function frame(time) {
    var dt = Math.min(0.05, (time - prev) / 1000 || 0);
    prev = time;
    if (match && s && !ui.game.classList.contains('hidden')) {
      update(dt);
      updateMeters();
      draw(time);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 테스트/디버그용 (콘솔에서 상태 확인)
  window.LongJump = {
    state: function () { return s; },
    match: function () { return match; },
    constants: { LINE_X: LINE_X, JUMP_ZONE: JUMP_ZONE },
  };

  SO.registerSW('../../sw.js');
  startSetup();
})();
