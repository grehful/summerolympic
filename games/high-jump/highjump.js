/*
 * 높이뛰기 (배면뛰기)
 *
 * 1. 달리기 버튼으로 속도를 내되 게이지의 초록 구간(시속 약 25~29km)을 지킨다. 너무 빠르면 오히려 손해
 * 2. 도약 표시 위에서 점프 버튼 → 도약. 표시에서 멀수록 높이 손해
 * 3. 공중에서 점프를 꾹 누르면 허리 젖히기(엉덩이 ↑), 떼면 다리 차올리기(다리 ↑).
 *    엉덩이가 바를 지나기 직전에 누르고, 다리가 지날 때 떼야 한다. 어깨·엉덩이·다리 중 하나라도 바보다 낮으면 실패
 * 4. 높이마다 3번 기회, 3번 실패하면 탈락. 모두 탈락할 때까지 바가 올라간다
 *    순위: 최고 성공 높이 → 그 높이에서의 실패 수 → 전체 실패 수 (실제 규칙)
 */
(function () {
  'use strict';

  // ---- 튜닝 값 ----
  var TAKEOFF_X = 20;       // 도약 표시 (m)
  var BAR_X = 21.1;         // 바 위치
  var JUMP_RANGE = 1.5;     // 도약 표시 ±이 거리 안에서만 점프 가능
  var V_MAX = 18;
  var TAP_BOOST = 1.0;
  var DRAG = 0.4;
  var ZONE_LO = 7.0;        // 적정 속도 (m/s) → 25.2 km/h
  var ZONE_HI = 8.0;        //                 → 28.8 km/h
  var GAUGE_MAX = 40 / 3.6; // 게이지 끝 = 시속 40km
  var BASE_H = 1.30;        // 최고점 = BASE_H + LIFT × 속도효율 × 도약효율
  var LIFT = 1.2;
  var FLIGHT = 1.5;         // 공중 장면 길이 (초)
  // 비행 중 각 부위가 바 위를 지나는 시점 (0~1)
  var CROSS = { shoulder: 0.44, hip: 0.52, leg: 0.62 };
  // 젖히기(누르기) 좋은 시점, 다리 차기(떼기) 좋은 시점: [0점 시작, 만점 시작, 만점 끝, 0점 끝]
  var ARCH_WIN = [0.18, 0.30, 0.47, 0.52];
  var KICK_WIN = [0.50, 0.54, 0.62, 0.75];
  var START_HEIGHTS = [150, 180, 200]; // cm
  var WORLD_RECORD = 245;

  var SO = window.SO;
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    setup: $('setup'), game: $('game'), final: $('final'),
    hudDot: $('hudDot'), hudName: $('hudName'), hudAttempt: $('hudAttempt'), hudBest: $('hudBest'),
    stage: $('stage'), canvas: $('canvas'),
    speed: $('speed'), barH: $('barH'), toLine: $('toLine'), banner: $('banner'),
    gauge: $('gauge'), needle: $('needle'), history: $('history'), timing: $('timing'),
    intro: $('intro'), introTurn: $('introTurn'), introName: $('introName'), introGo: $('introGo'),
    result: $('result'), resDist: $('resDist'), resBadge: $('resBadge'), resHistory: $('resHistory'),
    resDetail: $('resDetail'), resTable: $('resTable'), resNext: $('resNext'),
    runBtn: $('runBtn'), jumpBtn: $('jumpBtn'),
    finalTable: $('finalTable'), againBtn: $('againBtn'), setupBtn: $('setupBtn'),
  };
  var ctx = ui.canvas.getContext('2d');
  // 게이지의 초록 구간 위치
  var zone = ui.gauge.querySelector('.gauge-zone');
  zone.style.left = (ZONE_LO / GAUGE_MAX * 100) + '%';
  zone.style.width = ((ZONE_HI - ZONE_LO) / GAUGE_MAX * 100) + '%';

  // ---- 경기 진행 상태 ----
  var match = null;   // { players: [{name,color,hist:{cm:'XO'},out}], height(cm), turn:{p,attempt}, raised }
  var s = null;       // 현재 시기 상태

  function nextHeight(h) { return h < 200 ? h + 10 : h < 230 ? h + 5 : h + 3; }
  function fmtH(cm) { return (cm / 100).toFixed(2) + ' m'; }

  function newAttempt() {
    s = {
      phase: 'intro',     // intro → countdown → run → flight → landed | fail(run) → result
      x: 0, y: 0, v: 0, stride: 0, t: 0, lastTap: 0,
      takeoffX: 0, takeoffV: 0, peak: 0, sEff: 0, tEff: 0,
      flightT: 0,
      pressF: null, releaseF: null, holding: false,
      evaluated: false, cleared: null, hitPart: null, qa: 0, qk: 0,
      barDrop: 0,
      reason: '',
      cam: -3,
    };
  }

  function nextJumper() {
    var h = match.height;
    for (var a = 0; a < 3; a++) {
      for (var i = 0; i < match.players.length; i++) {
        var p = match.players[i];
        if (p.out) continue;
        var r = p.hist[h] || '';
        if (r.indexOf('O') < 0 && r.length === a) return { p: p, attempt: a + 1 };
      }
    }
    return null;
  }

  // ---- 화면 전환 ----
  function show(el) {
    [ui.setup, ui.game, ui.final].forEach(function (x) { x.classList.toggle('hidden', x !== el); });
  }

  function startSetup() {
    show(ui.setup);
    SO.setupPlayers(ui.setup, {
      title: '🤸 높이뛰기',
      storageKey: 'highjump',
      maxPlayers: 8,
      attemptChoices: START_HEIGHTS,
      defaultAttempts: 150,
      attemptLabel: '시작 높이',
      attemptUnit: 'cm',
      backHref: '../../',
    }, function (cfg) {
      SO.enterGameMode();
      startMatch(cfg.players, cfg.attempts);
    });
  }

  function startMatch(players, startCm) {
    match = {
      players: players.map(function (p) { return { name: p.name, color: p.color, hist: {}, out: false }; }),
      startCm: startCm,
      height: startCm,
      turn: null,
      raised: false,
    };
    show(ui.game);
    resize();
    match.turn = nextJumper();
    beginTurn();
  }

  // ---- 올림픽 모드: 나라 실력(★)에 따른 보너스 (★1 = 보너스 없음) ----
  var BASE = { LIFT: LIFT, ZONE_LO: ZONE_LO, ZONE_HI: ZONE_HI };
  function applyBoost(idx) {
    var k = SO.olympic.k('high-jump', idx);
    LIFT = BASE.LIFT * (1 + 0.05 * k);     // 더 높이
    ZONE_LO = BASE.ZONE_LO - 0.4 * k;      // 적정 속도 폭이 넓어짐
    ZONE_HI = BASE.ZONE_HI + 0.4 * k;
    zone.style.left = (ZONE_LO / GAUGE_MAX * 100) + '%';
    zone.style.width = ((ZONE_HI - ZONE_LO) / GAUGE_MAX * 100) + '%';
  }

  function beginTurn() {
    applyBoost(match.players.indexOf(match.turn.p));
    newAttempt();
    var p = match.turn.p;
    s.color = p.color;
    ui.hudDot.style.background = p.color;
    ui.hudName.textContent = p.name;
    ui.hudAttempt.textContent = fmtH(match.height) + ' · ' + match.turn.attempt + '차';
    var b = best(p);
    ui.hudBest.textContent = b == null ? '' : '최고 ' + fmtH(b);
    ui.introTurn.textContent = (match.raised ? '⬆ 바가 올라갔어요! ' : '') + fmtH(match.height) + ' · ' + match.turn.attempt + '/3차 시기';
    ui.introTurn.textContent += SO.olympic.introNote('high-jump', match.players.indexOf(match.turn.p));
    match.raised = false;
    ui.introName.textContent = p.name;
    ui.introName.style.color = p.color;
    ui.result.classList.add('hidden');
    ui.intro.classList.remove('hidden');
    ui.timing.classList.add('hidden');
    hideBanner();
    renderHistory(ui.history, p, true);
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
    if (s.phase !== 'run') return;
    s.v += TAP_BOOST * Math.max(0, 1 - s.v / V_MAX);
    s.lastTap = s.t;
    SO.sound.beep(160 + s.v * 14, 0.035, 'square', 0.05);
    SO.vibrate(8);
  }

  function nearTakeoff() { return s && s.phase === 'run' && Math.abs(s.x - TAKEOFF_X) <= JUMP_RANGE; }

  function jumpDown() {
    if (s.phase === 'run') {
      if (!nearTakeoff()) { shake(ui.jumpBtn); return; }
      takeoff();
    } else if (s.phase === 'flight' && s.pressF == null) {
      s.pressF = s.flightT / FLIGHT; // 허리 젖히기 시작
      s.holding = true;
    }
  }
  function jumpUp() {
    if (s.phase === 'flight' && s.holding) {
      s.holding = false;
      s.releaseF = s.flightT / FLIGHT; // 다리 차올리기
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

  // ---- 물리 ----
  function speedEff(v) {
    if (v < ZONE_LO) return Math.pow(v / ZONE_LO, 2);
    if (v > ZONE_HI) return Math.max(0.4, 1 - (v - ZONE_HI) * 0.22);
    return 1;
  }

  function takeoff() {
    var err = s.x - TAKEOFF_X;
    s.sEff = speedEff(s.v);
    s.tEff = Math.max(0.3, 1 - Math.pow(Math.abs(err) / 1.0, 1.6));
    s.peak = BASE_H + LIFT * s.sEff * s.tEff + (Math.random() - 0.5) * 0.03;
    s.takeoffX = s.x;
    s.takeoffV = s.v;
    s.flightT = 0;
    s.phase = 'flight';
    s.t = 0;
    SO.sound.sweep(300, 900, 0.3, 'triangle', 0.2);
    SO.vibrate(25);
  }

  // 비행 중 엉덩이(무게중심) 높이: 바 위(f=0.5)에서 최고점
  function hipY(f) {
    if (f <= 0.5) return 1.0 + (s.peak - 1.0) * (1 - Math.pow(1 - 2 * f, 2));
    return s.peak - (s.peak - 0.75) * Math.pow(2 * f - 1, 2);
  }
  function hipX(f) { return BAR_X + (f - 0.5) * 2 * (BAR_X - s.takeoffX); }

  function win(x, w) {
    if (x == null || x < w[0] || x > w[3]) return 0;
    if (x < w[1]) return (x - w[0]) / (w[1] - w[0]);
    if (x > w[2]) return (w[3] - x) / (w[3] - w[2]);
    return 1;
  }

  function evaluate() {
    s.evaluated = true;
    // 엉덩이가 지날 때까지 계속 누르고 있어야 젖히기 인정
    var heldAtHip = s.pressF != null && (s.releaseF == null || s.releaseF >= CROSS.hip);
    s.qa = heldAtHip ? win(s.pressF, ARCH_WIN) : 0;
    var rel = s.releaseF == null ? (s.pressF != null ? 1 : null) : s.releaseF;
    s.qk = s.pressF != null ? win(rel, KICK_WIN) : 0;
    var bar = match.height / 100;
    var parts = {
      '어깨': hipY(CROSS.shoulder),
      '엉덩이': hipY(CROSS.hip) - 0.25 + 0.35 * s.qa,
      '다리': hipY(CROSS.leg) - 0.40 + 0.48 * s.qk,
    };
    var low = null;
    Object.keys(parts).forEach(function (k) { if (low == null || parts[k] < parts[low]) low = k; });
    s.cleared = parts[low] >= bar + 0.01;
    s.hitPart = low;
    s.clearance = parts[low] - bar;
    showTiming('젖히기 ' + grade(s.qa, s.pressF, ARCH_WIN) + ' · 다리 ' + grade(s.qk, rel, KICK_WIN), s.cleared ? 'good' : 'late');
    if (s.cleared) {
      SO.sound.noise(1.6, 0.28, 2200);
      SO.vibrate([20, 30, 20]);
    } else {
      SO.sound.beep(320, 0.15, 'square', 0.18);
      SO.sound.noise(0.25, 0.4, 1500);
      SO.vibrate([80, 40, 80]);
    }
  }

  function grade(q, at, w) {
    if (at == null) return '없음';
    if (q >= 0.95) return '퍼펙트';
    if (q >= 0.6) return '좋아요';
    if (q > 0) return at < w[1] ? '조금 빨라요' : '조금 늦어요';
    return at < w[0] ? '너무 빨라요' : '너무 늦어요';
  }

  function runFail(reason) {
    s.phase = 'fail';
    s.t = 0;
    s.cleared = false;
    s.reason = reason;
    showBanner('실패', true);
    SO.sound.beep(140, 0.5, 'sawtooth', 0.2);
    SO.vibrate([80, 40, 80]);
  }

  function update(dt) {
    s.t += dt;
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
        s.v = Math.max(0, s.v - DRAG * s.v * dt);
        if (s.v < 0.15) s.v = 0;
        s.x += s.v * dt;
        s.stride += s.v * dt;
        if (s.x > BAR_X - 0.4) runFail('도약하지 못하고 바 밑으로 들어갔어요');
        else if (s.v === 0 && s.t - s.lastTap > 4) runFail('시간 초과');
        break;
      case 'flight': {
        s.flightT += dt;
        var f = Math.min(1, s.flightT / FLIGHT);
        s.x = hipX(f);
        s.y = hipY(f);
        if (!s.evaluated && f >= KICK_WIN[3]) evaluate();
        if (s.evaluated && !s.cleared) s.barDrop = Math.min(1, s.barDrop + dt * 2.2);
        if (f >= 1) { s.phase = 'landed'; s.t = 0; SO.sound.noise(0.3, 0.4, 500); }
        break;
      }
      case 'landed':
        if (!s.cleared) s.barDrop = Math.min(1, s.barDrop + dt * 2.2);
        if (s.t > 1.2) showResult();
        break;
      case 'fail':
        s.v = Math.max(0, s.v - 8 * dt);
        s.x += s.v * dt;
        s.stride += s.v * dt;
        if (s.t > 1.4) showResult();
        break;
    }
    var view = W / PPM;
    var target = s.phase === 'flight' || s.phase === 'landed' || s.phase === 'result'
      ? BAR_X - view * 0.45
      : Math.min(s.x - view * 0.3, BAR_X - view * 0.45);
    s.cam += (target - s.cam) * Math.min(1, dt * 5);
  }

  // ---- 결과 / 순위 ----
  function best(p) {
    var b = null;
    Object.keys(p.hist).forEach(function (h) { if (p.hist[h].indexOf('O') >= 0 && (b == null || +h > b)) b = +h; });
    return b;
  }
  function misses(r) { return (r.match(/X/g) || []).length; }
  function totalMisses(p) { return Object.keys(p.hist).reduce(function (n, h) { return n + misses(p.hist[h]); }, 0); }
  function compare(a, b) {
    var ba = best(a), bb = best(b);
    if (ba !== bb) return (bb == null ? -1 : bb) - (ba == null ? -1 : ba);
    if (ba == null) return 0;
    return misses(a.hist[ba]) - misses(b.hist[bb]) || totalMisses(a) - totalMisses(b);
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

  // 높이별 기록 칩: 1.80 O · 1.90 XO · 2.00 XXX
  function renderHistory(el, p, markNow) {
    var hs = Object.keys(p.hist).map(Number).sort(function (a, b) { return a - b; });
    var html = hs.map(function (h) {
      var r = p.hist[h].replace(/O/g, '<b>O</b>').replace(/X/g, '<i>X</i>');
      return '<span>' + (h / 100).toFixed(2) + ' ' + r + '</span>';
    });
    if (markNow && !(p.hist[match.height])) html.push('<span class="now">' + (match.height / 100).toFixed(2) + ' ?</span>');
    else if (markNow) html[html.length - 1] = html[html.length - 1].replace('<span>', '<span class="now">');
    el.innerHTML = html.slice(-6).join('');
  }

  function rankingRows(highlight, withHist) {
    return ranking().map(function (r) {
      var b = best(r.p);
      var hs = Object.keys(r.p.hist).map(Number).sort(function (a, c) { return a - c; });
      var hist = hs.map(function (h) { return (h / 100).toFixed(2) + ' ' + r.p.hist[h]; }).join(' · ');
      return '<tr class="' + (r.p === highlight ? 'me' : '') + '">' +
        '<td class="rank">' + (b == null ? '-' : medal(r.rank)) + '</td>' +
        '<td><span style="color:' + r.p.color + '">●</span> ' + esc(r.p.name) + (r.p.out ? ' <span class="muted">(탈락)</span>' : '') +
        (withHist && hist ? '<div class="marks">' + hist + '</div>' : '') + '</td>' +
        '<td class="num">' + (b == null ? '기록 없음' : fmtH(b)) + '</td></tr>';
    }).join('');
  }

  function showResult() {
    if (s.phase === 'result') return;
    s.phase = 'result';
    hideBanner();
    var p = match.turn.p;
    var h = match.height;
    var prevBest = best(p);
    p.hist[h] = (p.hist[h] || '') + (s.cleared ? 'O' : 'X');
    if (p.hist[h] === 'XXX') p.out = true;

    ui.resDist.classList.toggle('foul', !s.cleared);
    ui.resDist.textContent = s.cleared ? '성공 ✓' : (p.out ? '탈락 ✕' : '실패 ✕');
    ui.resBadge.textContent = h > WORLD_RECORD ? '🌍 세계 신기록!' : '개인 최고!';
    ui.resBadge.classList.toggle('hidden', !(s.cleared && (h > WORLD_RECORD || (prevBest != null && h > prevBest))));
    renderHistory(ui.resHistory, p, false);
    var lines = [];
    if (s.reason) lines.push(s.reason);
    else {
      lines.push(fmtH(h) + ' · 최고점 ' + s.peak.toFixed(2) + ' m · 시속 ' + (s.takeoffV * 3.6).toFixed(1) + ' km/h');
      lines.push('젖히기 ' + grade(s.qa, s.pressF, ARCH_WIN) + ' · 다리 ' + grade(s.qk, s.releaseF == null && s.pressF != null ? 1 : s.releaseF, KICK_WIN));
      if (!s.cleared) lines.push(s.hitPart + '가 바에 걸렸어요'); // 어깨/엉덩이/다리 모두 받침 없음
      if (s.sEff < 0.95) lines.push(s.takeoffV > ZONE_HI ? '너무 빨리 달렸어요' : '조금 더 빨리 달려야 해요');
      if (s.tEff < 0.8) lines.push('도약 표시에서 ' + (s.takeoffX > TAKEOFF_X ? '너무 가까이서' : '너무 멀리서') + ' 뛰었어요');
    }
    ui.resDetail.innerHTML = lines.map(esc).join('<br>');
    ui.resTable.innerHTML = rankingRows(p, false);

    // 다음 차례 정하기
    var next = nextJumper();
    if (!next) {
      if (match.players.every(function (q) { return q.out; })) next = null;
      else {
        match.height = nextHeight(match.height);
        match.raised = true;
        next = nextJumper();
      }
    }
    match.turn = next;
    ui.resNext.textContent = next
      ? '다음: ' + (match.players.length > 1 ? next.p.name + ' · ' : '') + fmtH(match.height) + ' ' + next.attempt + '차'
      : '최종 결과 보기';
    ui.result.classList.remove('hidden');
  }

  ui.resNext.addEventListener('click', function () {
    if (match.turn) beginTurn();
    else showFinal();
  });

  function showFinal() {
    ui.finalTable.innerHTML = '<tr><th></th><th>선수</th><th class="num">최고 기록</th></tr>' + rankingRows(null, true);
    show(ui.final);
    SO.olympic.onFinal('high-jump', ranking().map(function (r) {
      return { idx: match.players.indexOf(r.p), rank: r.rank, valid: best(r.p) != null };
    }), ui);
    SO.sound.noise(2, 0.25, 2200);
  }

  ui.againBtn.addEventListener('click', function () {
    SO.enterGameMode();
    startMatch(match.players, match.startCm);
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
    timingTimer = setTimeout(function () { ui.timing.classList.add('hidden'); }, 1400);
  }

  var lastHud = '';
  function updateHud() {
    var running = s.phase === 'run' || s.phase === 'countdown' || s.phase === 'intro';
    var v = running ? s.v : s.takeoffV;
    var near = nearTakeoff();
    var lineText = running ? (near ? '지금 점프!' : '도약 표시까지 ' + Math.max(0, TAKEOFF_X - s.x).toFixed(1) + ' m') : '';
    var waitingArch = s.phase === 'flight' && s.pressF == null;
    var key = [s.phase, v.toFixed(1), lineText, near, s.holding, waitingArch, match.height].join('|');
    if (key === lastHud) return;
    lastHud = key;
    ui.speed.textContent = (v * 3.6).toFixed(1);
    ui.barH.textContent = (match.height / 100).toFixed(2);
    ui.needle.style.left = Math.min(100, v / GAUGE_MAX * 100) + '%';
    ui.gauge.classList.toggle('good', v >= ZONE_LO && v <= ZONE_HI);
    ui.gauge.classList.toggle('fast', v > ZONE_HI);
    ui.toLine.textContent = lineText;
    ui.toLine.classList.toggle('hidden', !lineText);
    ui.toLine.classList.toggle('zone', near);
    ui.toLine.style.top = '168px';
    ui.jumpBtn.classList.toggle('ready', near || waitingArch);
    ui.jumpBtn.classList.toggle('holding', s.holding);
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
    PPM = Math.min(W / 7.5, H / 4.6);
    GROUND = H * 0.84;
  }
  window.addEventListener('resize', resize);

  function sx(x) { return (x - s.cam) * PPM; }
  function sy(y) { return GROUND - y * PPM; }

  function draw(time) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    SO.stadium.draw(ctx, {
      width: W, base: GROUND, ppm: PPM, cam: s.cam, time: time,
      cheer: s.evaluated && s.cleared ? 1 : 0.25,
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 바닥: 도움닫기 트랙
    var groundH = H - GROUND + 20;
    ctx.fillStyle = '#c2410c';
    ctx.fillRect(0, GROUND, W, groundH);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(0, GROUND + 2, W, 2);
    // 도약 표시
    var tx = sx(TAKEOFF_X);
    ctx.fillStyle = 'rgba(255, 210, 80, 0.3)';
    ctx.fillRect(sx(TAKEOFF_X - JUMP_RANGE), GROUND, JUMP_RANGE * 2 * PPM, groundH);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(tx - 9, GROUND + 6); ctx.lineTo(tx + 9, GROUND + 22);
    ctx.moveTo(tx + 9, GROUND + 6); ctx.lineTo(tx - 9, GROUND + 22);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '800 ' + Math.round(Math.max(12, PPM * 0.28)) + 'px system-ui, sans-serif';
    ctx.fillText('도약', tx, GROUND + 36);

    // 매트
    var m0 = sx(BAR_X + 0.15), m1 = sx(BAR_X + 4.2), mt = sy(0.7);
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(m0, mt, m1 - m0, GROUND - mt);
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(m0, mt - 6, m1 - m0, 8);

    // 지주 (높이 눈금)
    var bar = match.height / 100;
    var px = sx(BAR_X);
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(px - 3, sy(2.7), 6, GROUND - sy(2.7));
    ctx.fillStyle = '#334155';
    ctx.font = '700 ' + Math.round(Math.max(10, PPM * 0.2)) + 'px system-ui, sans-serif';
    for (var hh = 1.0; hh <= 2.6; hh += 0.1) {
      var yy = sy(hh);
      ctx.fillRect(px - 8, yy, 5, 1.5);
      if (Math.round(hh * 10) % 5 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillText(hh.toFixed(1), px - 22, yy);
        ctx.fillStyle = '#334155';
      }
    }

    // 선수 (지주 뒤에서 넘어가는 모습)
    drawAthlete(s.color);

    // 바: 실패하면 매트로 떨어짐
    var by = bar - (bar - 0.75) * Math.pow(s.barDrop, 2);
    var tilt = s.barDrop * 0.5;
    ctx.save();
    ctx.translate(px, sy(by));
    ctx.rotate(tilt);
    var half = PPM * 0.55;
    for (var k = 0; k < 6; k++) {
      ctx.fillStyle = k % 2 ? '#ef4444' : '#f8fafc';
      ctx.fillRect(-half + k * half / 3, -4, half / 3, 8);
    }
    ctx.restore();
    // 바 높이 표시
    if (s.barDrop === 0) {
      ctx.fillStyle = '#fde047';
      ctx.font = '800 ' + Math.round(Math.max(12, PPM * 0.28)) + 'px system-ui, sans-serif';
      ctx.fillText(fmtH(match.height), px + half + 34, sy(bar));
    }
  }

  // 배면뛰기 자세를 직접 그림: 엉덩이 위치, 몸통 방향, 허리 젖힘, 다리 차올림
  function drawFlop(hx, hy, phi, arch, kick, color) {
    var torso = phi - arch * 0.7;
    var thigh = phi + Math.PI + arch * 0.6 - kick * 1.1;
    var shin = thigh + (1 - kick) * 0.9;
    var pt = function (x, y, a, len) { return [x + Math.cos(a) * len, y + Math.sin(a) * len]; };
    var sh = pt(hx, hy, torso, 0.5);
    var head = pt(sh[0], sh[1], torso, 0.2);
    var knee = pt(hx, hy, thigh, 0.46);
    var foot = pt(knee[0], knee[1], shin, 0.46);
    var hand = pt(sh[0], sh[1], torso + Math.PI * 0.75, 0.55);
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
    line([sh, hand], 0.08, '#b07d5a');
    line([[hx, hy], knee, foot], 0.12, '#e6b38c');
    line([[hx, hy], sh], 0.2, color);
    ctx.fillStyle = '#1f2937';
    ctx.beginPath();
    ctx.arc(sx(hx), sy(hy), 0.12 * PPM, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = '#e6b38c';
    ctx.beginPath();
    ctx.arc(sx(head[0]), sy(head[1]), 0.13 * PPM, 0, 6.283);
    ctx.fill();
  }

  function drawAthlete(color) {
    var ph = s.phase;
    if (ph === 'flight' || ph === 'landed' || (ph === 'result' && !s.reason)) {
      var f = ph === 'flight' ? Math.min(1, s.flightT / FLIGHT) : 1;
      var phi = f < 0.5 ? 1.4 * (1 - 2 * f) : -0.9 * (f - 0.5) * 2;
      var arch = 0, kick = 0;
      if (s.pressF != null && f >= s.pressF) {
        var endArch = s.releaseF == null ? 1 : s.releaseF;
        arch = f < endArch ? Math.min(1, (f - s.pressF) / 0.08) : Math.max(0, 1 - (f - endArch) / 0.1);
      }
      if (s.releaseF != null && f >= s.releaseF) kick = Math.min(1, (f - s.releaseF) / 0.06);
      if (ph !== 'flight') { phi = -0.25; arch = 0; kick = 0.7; }
      drawFlop(s.x, ph === 'flight' ? s.y : 0.95, phi, arch, kick, color);
      return;
    }
    var pose = ph === 'run' || ph === 'fail'
      ? SO.athlete.runPose(s.stride, Math.min(1, s.v / 6), 0)
      : SO.athlete.standPose();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(sx(s.x), GROUND + 2, PPM * 0.35, 4, 0, 0, 6.283);
    ctx.fill();
    SO.athlete.draw(ctx, pose, { x: s.x, y: 0, toX: sx, toY: sy, ppm: PPM, color: color });
  }

  // ---- 메인 루프 ----
  var prev = 0;
  function frame(time) {
    var dt = Math.min(0.05, (time - prev) / 1000 || 0);
    prev = time;
    if (match && s && match.turn && !ui.game.classList.contains('hidden')) {
      if (s.phase !== 'intro' && s.phase !== 'result') update(dt);
      updateHud();
      draw(time);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 테스트/디버그용
  window.HighJump = {
    state: function () { return s; },
    match: function () { return match; },
    flightF: function () { return s.phase === 'flight' ? s.flightT / FLIGHT : null; },
    constants: { TAKEOFF_X: TAKEOFF_X, ZONE_LO: ZONE_LO, ZONE_HI: ZONE_HI },
  };

  SO.registerSW('../../sw.js');
  if (SO.olympic.active()) SO.olympic.start('high-jump', startMatch);
  else startSetup();
})();
