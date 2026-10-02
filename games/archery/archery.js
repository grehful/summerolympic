/*
 * 양궁 (70m, 122cm 과녁)
 *
 * 1. 버튼을 꾹 누르면 활을 당김 → 누른 채로 끌어서 조준 → 떼면 발사
 * 2. 조준점은 늘 흔들린다. 당긴 지 1~4초가 가장 안정, 그 뒤로는 팔이 지쳐 점점 심해지고 8초면 풀림
 * 3. 바람(m/s)만큼 화살이 옆으로 밀린다 (1 m/s ≈ 점수 한 칸 반). 조준하는 동안에도 바람이 조금씩 변함
 * 4. 한 발 20초, 3발 = 1엔드. 총점 → 10점 개수 → X 개수 순으로 순위
 * 좌표 단위는 cm, 과녁 중심이 (0,0), y는 아래쪽이 +.
 */
(function () {
  'use strict';

  // ---- 튜닝 값 ----
  var FACE_R = 61;          // 과녁 반지름 (cm)
  var RING = 6.1;           // 점수 한 칸 너비 (cm)
  var X_R = 3.05;           // X (정중앙) 반지름
  var ARROW_R = 0.3;        // 화살 굵기 — 선에 걸치면 높은 점수 (실제 규칙)
  var ARROWS_PER_END = 3;
  var SHOT_CLOCK = 20;      // 한 발 제한 시간 (초)
  var DRAW_TIME = 1;        // 이만큼 당겨야 쏠 수 있음
  var STEADY_END = 4;       // 여기까지가 안정 구간
  var HOLD_MAX = 8;         // 이 이상 버티면 활이 풀림
  var WIND_PUSH = 8;        // 바람 1 m/s당 밀리는 거리 (cm) ≈ 점수 한 칸 반
  var WIND_MAX = 4;
  var SPREAD = 2.0;         // 활/화살 자체의 오차 (cm, 표준편차)
  var AIM_SENS = 0.16;      // 손가락 1px 이동당 조준 이동 (cm)
  var FLIGHT_TIME = 0.7;    // 화살 날아가는 연출 시간 (초)

  var SO = window.SO;
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    setup: $('setup'), game: $('game'), final: $('final'),
    hudDot: $('hudDot'), hudName: $('hudName'), hudEnd: $('hudEnd'), hudTotal: $('hudTotal'),
    stage: $('stage'), canvas: $('canvas'),
    wind: $('wind'), windArrow: $('windArrow'), clock: $('clock'), clockBox: $('clockBox'),
    endStrip: $('endStrip'), banner: $('banner'),
    breath: $('breath'), breathCursor: $('breathCursor'), breathLabel: $('breathLabel'),
    intro: $('intro'), introTurn: $('introTurn'), introName: $('introName'), introGo: $('introGo'),
    result: $('result'), resTitle: $('resTitle'), resArrows: $('resArrows'), resDetail: $('resDetail'),
    resTable: $('resTable'), resNext: $('resNext'),
    aimPad: $('aimPad'), padText: $('padText'),
    finalTable: $('finalTable'), againBtn: $('againBtn'), setupBtn: $('setupBtn'),
  };
  var ctx = ui.canvas.getContext('2d');

  // ---- 경기 진행 상태 ----
  var match = null;   // { players: [{name,color,ends:[[{score,x,px,py}]],sight}], ends, turn }
  var s = null;       // 현재 엔드 상태
  var now = 0;        // 초 단위 시계 (흔들림/바람 계산용)

  function currentPlayer() { return match.players[match.turn % match.players.length]; }
  function currentEnd() { return Math.floor(match.turn / match.players.length) + 1; }
  function totalTurns() { return match.players.length * match.ends; }

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function gauss() { return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()); }

  function newEnd() {
    var p = currentPlayer();
    s = {
      phase: 'intro',     // intro → aim ⇄ draw → flight → hit → (aim | done) → result
      arrows: [],         // 이번 엔드에 쏜 화살
      aimX: p.sight.x, aimY: p.sight.y,
      clock: SHOT_CLOCK,
      drawStart: 0,
      t: 0,
      flight: null,
      lastTick: 0,
    };
    newWind();
  }

  // 한 발마다 바람과 흔들림 무늬가 새로 정해진다
  function newWind() {
    var speed = 0.3 + Math.pow(Math.random(), 1.3) * (WIND_MAX - 0.3);
    s.wind0 = (Math.random() < 0.5 ? -1 : 1) * speed;
    s.gust = 0.45 + 0.18 * speed;
    s.ph = [rnd(0, 6.28), rnd(0, 6.28), rnd(0, 6.28), rnd(0, 6.28), rnd(0, 6.28), rnd(0, 6.28)];
  }
  function windNow() {
    return s.wind0 + s.gust * (0.6 * Math.sin(0.8 * now + s.ph[4]) + 0.4 * Math.sin(2.1 * now + s.ph[5]));
  }

  // 당긴 시간에 따른 흔들림 크기 (cm)
  function swayAmp(h) {
    if (h < DRAW_TIME) return 24;
    if (h < 2.5) return 24 - 17.5 * (h - DRAW_TIME) / (2.5 - DRAW_TIME);
    if (h < STEADY_END) return 6.5;
    return 6.5 + 34 * Math.pow((h - STEADY_END) / (HOLD_MAX - STEADY_END), 1.5);
  }
  // 숨쉬듯 8자로 움직이는 흔들림
  function sway() {
    var amp = s.phase === 'draw' ? swayAmp(now - s.drawStart) : 14;
    var p = s.ph;
    return {
      x: amp * (0.7 * Math.sin(1.1 * now + p[0]) + 0.3 * Math.sin(2.7 * now + p[1])),
      y: amp * (0.7 * Math.sin(1.5 * now + p[2]) + 0.3 * Math.sin(3.1 * now + p[3])),
    };
  }

  function scoreOf(x, y) {
    var r = Math.max(0, Math.hypot(x, y) - ARROW_R);
    if (r <= X_R) return { score: 10, x: true };
    if (r < FACE_R) return { score: 10 - Math.floor(r / RING), x: false };
    return { score: 0, x: false };
  }
  function label(a) { return a.x ? 'X' : a.score === 0 ? 'M' : String(a.score); }
  function scoreClass(a) {
    if (a.score >= 9) return 's-gold';
    if (a.score >= 7) return 's-red';
    if (a.score >= 5) return 's-blue';
    if (a.score >= 3) return 's-black';
    if (a.score >= 1) return 's-white';
    return 's-miss';
  }

  // ---- 화면 전환 ----
  function show(el) {
    [ui.setup, ui.game, ui.final].forEach(function (x) { x.classList.toggle('hidden', x !== el); });
  }

  function startSetup() {
    show(ui.setup);
    SO.setupPlayers(ui.setup, {
      title: '🏹 양궁',
      storageKey: 'archery',
      maxPlayers: 8,
      attemptChoices: [2, 4, 6],
      defaultAttempts: 2,
      attemptLabel: '엔드 수 (1엔드 = 3발)',
      attemptUnit: '엔드',
      backHref: '../../',
    }, function (cfg) {
      SO.enterGameMode();
      startMatch(cfg.players, cfg.attempts);
    });
  }

  function startMatch(players, ends) {
    match = {
      players: players.map(function (p) { return { name: p.name, color: p.color, ends: [], sight: { x: 0, y: 0 } }; }),
      ends: ends,
      turn: 0,
    };
    show(ui.game);
    resize();
    beginTurn();
  }

  function beginTurn() {
    newEnd();
    var p = currentPlayer();
    ui.hudDot.style.background = p.color;
    ui.hudName.textContent = p.name;
    ui.hudEnd.textContent = currentEnd() + '/' + match.ends + '엔드';
    ui.hudTotal.textContent = '합계 ' + total(p);
    ui.introTurn.textContent = currentEnd() + '엔드' + (match.players.length > 1 ? ' · ' + (match.turn % match.players.length + 1) + '번째 선수' : '');
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
    startArrow();
  });

  function startArrow() {
    s.phase = 'aim';
    s.clock = SHOT_CLOCK;
    s.lastTick = SHOT_CLOCK;
    if (s.arrows.length) newWind();
    showBanner(s.arrows.length + 1 + '번째 화살', false);
    setTimeout(function () { if (ui.banner.textContent.indexOf('화살') > 0) hideBanner(); }, 900);
  }

  // ---- 입력: 누르기 = 당기기, 끌기 = 조준, 떼기 = 발사 ----
  var drag = null;
  ui.aimPad.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (s.phase !== 'aim' || drag) return;
    try { ui.aimPad.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    s.phase = 'draw';
    s.drawStart = now;
    SO.sound.sweep(90, 160, 0.9, 'sawtooth', 0.05);
    SO.vibrate(15);
  });
  ui.aimPad.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    moveAim(e.clientX - drag.x, e.clientY - drag.y);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    ui.aimPad.addEventListener(ev, function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      if (s.phase === 'draw') release();
    });
  });
  document.addEventListener('contextmenu', function (e) { if (!ui.game.classList.contains('hidden')) e.preventDefault(); });

  function moveAim(dx, dy) {
    s.aimX = Math.max(-90, Math.min(90, s.aimX + dx * AIM_SENS));
    s.aimY = Math.max(-90, Math.min(90, s.aimY + dy * AIM_SENS));
  }

  // 키보드 (PC 테스트용): 스페이스 누르고 있기 = 당기기, 방향키 = 조준
  document.addEventListener('keydown', function (e) {
    if (!match || ui.game.classList.contains('hidden')) return;
    if (e.code === 'Space' && !e.repeat && s.phase === 'aim') { e.preventDefault(); s.phase = 'draw'; s.drawStart = now; }
    var k = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[e.code];
    if (k && (s.phase === 'aim' || s.phase === 'draw')) { e.preventDefault(); moveAim(k[0], k[1]); }
  });
  document.addEventListener('keyup', function (e) {
    if (e.code === 'Space' && s && s.phase === 'draw') release();
  });

  function release() {
    var h = now - s.drawStart;
    if (h < DRAW_TIME) {
      s.phase = 'aim';
      showBanner('덜 당겼어요', true);
      setTimeout(function () { if (ui.banner.textContent === '덜 당겼어요') hideBanner(); }, 700);
      return;
    }
    var sw = sway();
    var w = windNow();
    var tx = s.aimX + sw.x + w * WIND_PUSH + gauss() * SPREAD;
    var ty = s.aimY + sw.y + gauss() * SPREAD;
    shoot(tx, ty, { wind: w, hold: h, sx: s.aimX + sw.x, sy: s.aimY + sw.y });
  }

  function shoot(tx, ty, info) {
    s.phase = 'flight';
    s.t = 0;
    s.flight = { fromX: info.sx, fromY: info.sy, x: tx, y: ty, info: info };
    SO.sound.beep(110, 0.12, 'sawtooth', 0.15);
    SO.sound.noise(0.12, 0.25, 3000);
    SO.vibrate(25);
  }

  function hit() {
    var f = s.flight;
    var sc = f.timeout ? { score: 0, x: false } : scoreOf(f.x, f.y);
    var a = { score: sc.score, x: sc.x, px: f.x, py: f.y, timeout: !!f.timeout };
    s.arrows.push(a);
    s.phase = 'hit';
    s.t = 0;
    if (!f.timeout) {
      SO.sound.noise(0.18, 0.5, 450);
      SO.vibrate(a.score >= 9 ? [30, 40, 30] : 30);
      if (a.score >= 10) SO.sound.noise(1.3, 0.22, 2200);
    }
    showBanner(f.timeout ? '시간 초과' : a.x ? 'X!' : a.score === 0 ? '빗나감' : a.score + '점', a.score === 0);
  }

  // ---- 진행 ----
  function update(dt) {
    now += dt;
    s.t += dt;
    switch (s.phase) {
      case 'aim':
      case 'draw':
        s.clock -= dt;
        if (s.clock <= 5 && Math.ceil(s.clock) < s.lastTick) {
          s.lastTick = Math.ceil(s.clock);
          if (s.lastTick > 0) SO.sound.beep(700, 0.06, 'sine', 0.12);
        }
        if (s.clock <= 0) {
          drag = null;
          s.flight = { x: 999, y: 999, timeout: true };
          hit();
          break;
        }
        if (s.phase === 'draw' && now - s.drawStart >= HOLD_MAX) {
          s.phase = 'aim';
          drag = null;
          showBanner('팔이 풀렸어요', true);
          SO.sound.sweep(160, 80, 0.4, 'sawtooth', 0.08);
          setTimeout(function () { if (ui.banner.textContent === '팔이 풀렸어요') hideBanner(); }, 900);
        }
        break;
      case 'flight':
        if (s.t >= FLIGHT_TIME) hit();
        break;
      case 'hit':
        if (s.t > 1.3) {
          hideBanner();
          if (s.arrows.length >= ARROWS_PER_END) showResult();
          else startArrow();
        }
        break;
    }
  }

  // ---- 결과 / 순위 ----
  function allArrows(p) { return [].concat.apply([], p.ends); }
  function total(p) { return allArrows(p).reduce(function (n, a) { return n + a.score; }, 0); }
  function tens(p) { return allArrows(p).filter(function (a) { return a.score === 10; }).length; }
  function xs(p) { return allArrows(p).filter(function (a) { return a.x; }).length; }
  function compare(a, b) { return total(b) - total(a) || tens(b) - tens(a) || xs(b) - xs(a); }
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

  function rankingRows(highlight, withDetail) {
    return ranking().map(function (r) {
      var shot = allArrows(r.p).length > 0;
      var detail = '10점 ' + tens(r.p) + ' · X ' + xs(r.p) + ' · 엔드 ' + r.p.ends.map(function (e) {
        return e.reduce(function (n, a) { return n + a.score; }, 0);
      }).join('/');
      return '<tr class="' + (r.p === highlight ? 'me' : '') + '">' +
        '<td class="rank">' + (shot ? medal(r.rank) : '-') + '</td>' +
        '<td><span style="color:' + r.p.color + '">●</span> ' + esc(r.p.name) +
        (withDetail && shot ? '<div class="marks">' + detail + '</div>' : '') + '</td>' +
        '<td class="num">' + (shot ? total(r.p) + '점' : '-') + '</td></tr>';
    }).join('');
  }

  function showResult() {
    s.phase = 'result';
    var p = currentPlayer();
    p.ends.push(s.arrows);
    p.sight = { x: s.aimX, y: s.aimY }; // 조준 위치는 다음 엔드에도 이어짐
    var endSum = s.arrows.reduce(function (n, a) { return n + a.score; }, 0);
    ui.hudTotal.textContent = '합계 ' + total(p);
    ui.resTitle.textContent = p.name + ' · ' + currentEnd() + '엔드';
    ui.resArrows.innerHTML = s.arrows.map(function (a) {
      return '<span class="slot ' + scoreClass(a) + '">' + label(a) + '</span>';
    }).join('');
    ui.resDetail.textContent = '이번 엔드 ' + endSum + '점 · 합계 ' + total(p) + '점' + (endSum >= 29 ? ' 🔥' : '');
    ui.resTable.innerHTML = match.players.length > 1 ? rankingRows(p, false) : '';
    var last = match.turn + 1 >= totalTurns();
    if (last) ui.resNext.textContent = '최종 결과 보기';
    else {
      var np = match.players[(match.turn + 1) % match.players.length];
      ui.resNext.textContent = match.players.length > 1 ? '다음: ' + np.name : '다음 엔드';
    }
    ui.result.classList.remove('hidden');
    updateHud();
  }

  ui.resNext.addEventListener('click', function () {
    match.turn++;
    if (match.turn >= totalTurns()) showFinal();
    else beginTurn();
  });

  function showFinal() {
    ui.finalTable.innerHTML = '<tr><th></th><th>선수</th><th class="num">총점</th></tr>' + rankingRows(null, true);
    show(ui.final);
    SO.sound.noise(2, 0.25, 2200);
  }

  ui.againBtn.addEventListener('click', function () {
    SO.enterGameMode();
    startMatch(match.players, match.ends);
  });
  ui.setupBtn.addEventListener('click', startSetup);

  // ---- 화면 표시 ----
  function showBanner(text, red) {
    ui.banner.textContent = text;
    ui.banner.classList.toggle('red', !!red);
    ui.banner.classList.toggle('long', text.length > 4);
    ui.banner.classList.remove('hidden', 'pop');
    void ui.banner.offsetWidth;
    ui.banner.classList.add('pop');
  }
  function hideBanner() { ui.banner.classList.add('hidden'); }

  var lastHud = '';
  function updateHud() {
    var w = s.phase === 'flight' || s.phase === 'hit' ? s.flight.info ? s.flight.info.wind : windNow() : windNow();
    var clock = Math.max(0, Math.ceil(s.clock));
    var drawing = s.phase === 'draw';
    var h = drawing ? now - s.drawStart : 0;
    var breathText = !drawing ? '' : h < DRAW_TIME ? '당기는 중…' : h < STEADY_END ? '지금! 숨 참고 집중' : '팔이 떨려요!';
    var key = [s.phase, w.toFixed(1), clock, s.arrows.length, breathText, Math.round(h * 20)].join('|');
    if (key === lastHud) return;
    lastHud = key;

    ui.wind.textContent = Math.abs(w).toFixed(1);
    ui.windArrow.textContent = Math.abs(w) < 0.05 ? '·' : w > 0 ? '→' : '←';
    ui.clock.textContent = clock;
    ui.clockBox.classList.toggle('urgent', clock <= 5 && (s.phase === 'aim' || s.phase === 'draw'));

    var slots = '';
    for (var i = 0; i < ARROWS_PER_END; i++) {
      var a = s.arrows[i];
      slots += a ? '<span class="slot on ' + scoreClass(a) + '">' + label(a) + '</span>' : '<span class="slot"></span>';
    }
    var sum = s.arrows.reduce(function (n, a) { return n + a.score; }, 0);
    ui.endStrip.innerHTML = '<span>이번 엔드</span>' + slots + '<span class="sum">' + sum + '점</span>';

    ui.breath.classList.toggle('hidden', !drawing);
    ui.breathCursor.style.left = Math.min(100, h / HOLD_MAX * 100) + '%';
    ui.breathLabel.textContent = breathText;
    ui.breathLabel.style.color = h < DRAW_TIME ? '#cbd5e1' : h < STEADY_END ? 'var(--good)' : 'var(--bad)';
    ui.aimPad.classList.toggle('drawing', drawing);
    ui.padText.textContent = drawing ? '조준 중… 떼면 발사' : '꾹 눌러서 당기기';
  }

  // ---- 그리기 ----
  var W = 0, H = 0, DPR = 1, PX = 2, CX = 0, CY = 0;
  function resize() {
    var r = ui.stage.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    ui.canvas.width = Math.round(W * DPR);
    ui.canvas.height = Math.round(H * DPR);
    var top = 140, bottom = 54; // 위쪽 계기판, 아래쪽 호흡 막대 자리
    var avail = Math.max(120, H - top - bottom);
    PX = Math.min(W * 0.40, avail * 0.46) / FACE_R; // 1cm당 픽셀
    CX = W / 2;
    CY = top + avail / 2;
  }
  window.addEventListener('resize', resize);

  function tx(x) { return CX + x * PX; }
  function ty(y) { return CY + y * PX; }

  var RING_COLORS = ['#facc15', '#facc15', '#ef4444', '#ef4444', '#38bdf8', '#38bdf8', '#1f2937', '#1f2937', '#f8fafc', '#f8fafc'];

  function draw(time) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // 하늘, 숲, 잔디
    var horizon = ty(-FACE_R * 0.35);
    var sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#5aa9e6');
    sky.addColorStop(1, '#cdeaff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon);
    ctx.fillStyle = '#2f6b3a';
    for (var tr = -1; tr < W / 26 + 1; tr++) {
      var th = 18 + ((tr * 37) % 13);
      ctx.beginPath();
      ctx.arc(tr * 26 + 13, horizon, th, Math.PI, 0);
      ctx.fill();
    }
    var grass = ctx.createLinearGradient(0, horizon, 0, H);
    grass.addColorStop(0, '#6aa84f');
    grass.addColorStop(1, '#3f7d2c');
    ctx.fillStyle = grass;
    ctx.fillRect(0, horizon, W, H - horizon);

    // 과녁 받침대 (짚단)
    var boss = FACE_R * 1.22;
    ctx.fillStyle = '#6b4f2a';
    ctx.fillRect(tx(-boss * 0.75), ty(boss * 0.8), 6, PX * 60);
    ctx.fillRect(tx(boss * 0.75) - 6, ty(boss * 0.8), 6, PX * 60);
    ctx.fillStyle = '#d9b86c';
    ctx.fillRect(tx(-boss), ty(-boss), boss * 2 * PX, boss * 2 * PX);
    ctx.strokeStyle = 'rgba(120, 85, 30, 0.35)';
    ctx.lineWidth = 1;
    for (var sl = -boss; sl < boss; sl += 7) {
      ctx.beginPath();
      ctx.moveTo(tx(-boss), ty(sl));
      ctx.lineTo(tx(boss), ty(sl + 3));
      ctx.stroke();
    }


    // 과녁 면
    for (var i = 9; i >= 0; i--) {
      var r = (i + 1) * RING;
      ctx.fillStyle = RING_COLORS[i];
      ctx.beginPath();
      ctx.arc(CX, CY, r * PX, 0, 6.283);
      ctx.fill();
      ctx.strokeStyle = i === 6 || i === 7 ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.arc(CX, CY, X_R * PX, 0, 6.283);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(CX - 4, CY); ctx.lineTo(CX + 4, CY);
    ctx.moveTo(CX, CY - 4); ctx.lineTo(CX, CY + 4);
    ctx.stroke();

    // 바람 깃발 (화면 양쪽 장대)
    drawFlag(W * 0.07, time);
    drawFlag(W * 0.93, time + 400);

    // 꽂힌 화살들
    var color = currentPlayer().color;
    s.arrows.forEach(function (a) { if (!a.timeout) drawArrowHit(a.px, a.py, color); });

    // 날아가는 화살: 내 쪽에서 과녁으로 작아지며 날아감
    if (s.phase === 'flight') {
      var f = s.flight;
      var k = Math.min(1, s.t / FLIGHT_TIME);
      var e = 1 - Math.pow(1 - k, 2);
      var startX = CX, startY = H + 40;
      var fx = startX + (tx(f.x) - startX) * e;
      var fy = startY + (ty(f.y) - startY) * e - Math.sin(k * Math.PI) * PX * 25;
      var size = 26 * (1 - e) + 4;
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = Math.max(2, size * 0.15);
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + size * 0.2, fy + size);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(fx + size * 0.2, fy + size, size * 0.22, 0, 6.283);
      ctx.fill();
    }

    // 조준점
    if (s.phase === 'aim' || s.phase === 'draw') {
      var sw = sway();
      var rx = tx(s.aimX + sw.x), ry = ty(s.aimY + sw.y);
      var h = s.phase === 'draw' ? now - s.drawStart : 0;
      var col = s.phase === 'aim' ? 'rgba(255,255,255,0.55)' : h < DRAW_TIME ? '#e2e8f0' : h < STEADY_END ? '#4ade80' : '#f87171';
      var rr = Math.max(12, 3.5 * PX);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 5;
      ring(rx, ry, rr);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ring(rx, ry, rr);
      ctx.beginPath();
      ctx.moveTo(rx - rr * 1.7, ry); ctx.lineTo(rx - rr * 0.5, ry);
      ctx.moveTo(rx + rr * 0.5, ry); ctx.lineTo(rx + rr * 1.7, ry);
      ctx.moveTo(rx, ry - rr * 1.7); ctx.lineTo(rx, ry - rr * 0.5);
      ctx.moveTo(rx, ry + rr * 0.5); ctx.lineTo(rx, ry + rr * 1.7);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(rx, ry, 2.5, 0, 6.283);
      ctx.fill();
    }
  }

  function ring(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.283);
    ctx.stroke();
  }

  function drawArrowHit(x, y, color) {
    var px = tx(x), py = ty(y);
    // 비스듬히 튀어나온 화살대
    ctx.strokeStyle = 'rgba(17,24,39,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + 9, py + 16);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px + 9, py + 16, 4.5, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = '#0b1420';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2.5, ARROW_R * PX * 1.5), 0, 6.283);
    ctx.fill();
  }

  // 바람이 셀수록 깃발이 옆으로 눕고 빨리 펄럭인다
  function drawFlag(x, time) {
    var w = windNow();
    var top = ty(-FACE_R * 0.75);
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(x - 2, top, 4, H - top);
    var poleH = 0, y = top; // 깃발은 장대 꼭대기에
    var len = Math.max(30, W * 0.1);
    var strength = Math.min(1, Math.abs(w) / WIND_MAX);
    var droop = (1 - strength) * 1.2;
    var dir = w >= 0 ? 1 : -1;
    var flap = Math.sin(time / (140 - 80 * strength)) * (0.15 + 0.2 * strength);
    var ang = dir > 0 ? droop + flap : Math.PI - droop - flap;
    var x2 = x + Math.cos(ang) * len, y2 = y - poleH + 4 + Math.sin(ang) * len;
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(x, y - poleH);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x, y - poleH + len * 0.4);
    ctx.closePath();
    ctx.fill();
  }

  // ---- 메인 루프 ----
  var prev = 0;
  function frame(time) {
    var dt = Math.min(0.05, (time - prev) / 1000 || 0);
    prev = time;
    if (match && s && !ui.game.classList.contains('hidden')) {
      if (s.phase !== 'intro' && s.phase !== 'result') update(dt);
      else now += dt;
      updateHud();
      draw(time);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 테스트/디버그용
  window.Archery = {
    state: function () { return s; },
    match: function () { return match; },
    wind: function () { return windNow(); },
    holdTime: function () { return s.phase === 'draw' ? now - s.drawStart : 0; },
    constants: { WIND_PUSH: WIND_PUSH, AIM_SENS: AIM_SENS },
  };

  SO.registerSW('../../sw.js');
  startSetup();
})();
