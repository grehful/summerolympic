/*
 * 역도 (용상: 클린 앤 저크)
 *
 * 0. 매 시기 직접 무게를 정한다. 무게는 내릴 수 없음 (성공하면 +1kg 이상, 실패하면 같은 무게 이상)
 * 1. 클린: 왔다 갔다 하는 바늘이 초록 구간에 있을 때 탭 → 바벨을 어깨로
 * 2. 저크: 더 빠르고 좁아진 바늘을 한 번 더 → 머리 위로 (정확할수록 처음 기울기가 작음)
 * 3. 버티기: 머리 위 바벨은 기울어지려 한다(거꾸로 세운 막대처럼). 내려간 쪽 버튼을 눌러 3초 버티면 굿 리프트
 * 무거울수록 바늘이 빠르고 구간이 좁고, 더 잘 기운다. 1인 3시기, 성공한 최고 무게로 순위
 */
(function () {
  'use strict';

  // ---- 튜닝 값 ----
  var MIN_KG = 40;
  var MAX_KG = 400;
  var FIRST_KG = 120;        // 첫 시기 기본값
  var STAGE_TIMEOUT = 10;    // 각 단계 제한 시간 (초)
  var HOLD_TIME = 3;         // 버티기 시간 (초)
  var TILT_LIMIT = 14;       // 이 각도(°) 넘게 기울면 실패
  var TORQUE = 22;           // 버튼을 누를 때 바로잡는 힘 (°/s²)
  var DAMPING = 0.8;
  var WORLD_RECORD = 267;    // 남자 용상 세계기록 수준
  var PLATES = [             // 무게, 지름(m), 두께(m), 색
    [25, 0.45, 0.055, '#dc2626'], [20, 0.45, 0.048, '#2563eb'], [15, 0.40, 0.042, '#eab308'],
    [10, 0.45, 0.035, '#16a34a'], [5, 0.23, 0.03, '#f1f5f9'], [2.5, 0.19, 0.022, '#dc2626'],
    [2, 0.17, 0.02, '#2563eb'], [1.5, 0.15, 0.018, '#eab308'], [1, 0.13, 0.016, '#16a34a'], [0.5, 0.11, 0.014, '#f1f5f9'],
  ];
  var BAR_Y = { floor: 0.225, rack: 1.45, over: 2.12 };

  var SO = window.SO;
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    setup: $('setup'), game: $('game'), final: $('final'),
    hudDot: $('hudDot'), hudName: $('hudName'), hudAttempt: $('hudAttempt'), hudBest: $('hudBest'),
    stage: $('stage'), canvas: $('canvas'),
    kg: $('kg'), step: $('step'), banner: $('banner'),
    gauge: $('gauge'), zone: $('zone'), needle: $('needle'),
    balance: $('balance'), tilt: $('tilt'), holdFill: $('holdFill'),
    intro: $('intro'), introTurn: $('introTurn'), introName: $('introName'), introGo: $('introGo'),
    pickKg: $('pickKg'), pickHint: $('pickHint'),
    result: $('result'), resKg: $('resKg'), resBadge: $('resBadge'), resDetail: $('resDetail'),
    resTable: $('resTable'), resNext: $('resNext'),
    leftBtn: $('leftBtn'), rightBtn: $('rightBtn'), leftText: $('leftText'), rightText: $('rightText'),
    leftIcon: $('leftIcon'), rightIcon: $('rightIcon'),
    finalTable: $('finalTable'), againBtn: $('againBtn'), setupBtn: $('setupBtn'),
  };
  var ctx = ui.canvas.getContext('2d');

  // ---- 경기 진행 상태 ----
  var match = null;   // { players: [{name,color,attempts:[{kg,ok}]}], turn }
  var s = null;

  function currentPlayer() { return match.players[match.turn % match.players.length]; }
  function currentRound() { return Math.floor(match.turn / match.players.length) + 1; }
  function totalTurns() { return match.players.length * 3; }

  function difficulty(kg) { return Math.max(0, Math.min(1.3, (kg - 100) / 170)); }

  function newAttempt(kg) {
    var x = difficulty(kg);
    s = {
      phase: 'intro',     // intro → clean → rack → jerk → hold → good | fail → result
      kg: kg,
      t: 0,
      freq: 0.7 + 0.9 * x,          // 바늘 왕복 속도 (회/초)
      width: Math.max(0.04, Math.min(0.34, 0.34 - 0.26 * x)),
      center: 0.5,
      needle: 0,
      q: [],                         // 클린/저크 정확도 0~1
      barY: BAR_Y.floor, barFrom: BAR_Y.floor, barTo: BAR_Y.floor, barK: 1,
      tilt: 0, omega: 0,
      instab: 0.8 + 7 * x,
      noise: 18 * kg / 200,
      left: false, right: false,
      holdT: 0,
      lights: null,                  // [true/false ×3]
      ok: false,
      reason: '',
    };
  }

  // ---- 화면 전환 ----
  function show(el) {
    [ui.setup, ui.game, ui.final].forEach(function (x) { x.classList.toggle('hidden', x !== el); });
  }

  function startSetup() {
    show(ui.setup);
    SO.setupPlayers(ui.setup, {
      title: '🏋️ 역도',
      storageKey: 'weightlifting',
      maxPlayers: 8,
      backHref: '../../',
    }, function (cfg) {
      SO.enterGameMode();
      startMatch(cfg.players);
    });
  }

  function startMatch(players) {
    match = {
      players: players.map(function (p) { return { name: p.name, color: p.color, attempts: [] }; }),
      turn: 0,
    };
    show(ui.game);
    resize();
    beginTurn();
  }

  // 이번 시기에 고를 수 있는 최소 무게와 기본값
  function minKg(p) {
    var last = p.attempts[p.attempts.length - 1];
    if (!last) return MIN_KG;
    return last.ok ? last.kg + 1 : last.kg;
  }
  function defaultKg(p) {
    var last = p.attempts[p.attempts.length - 1];
    if (!last) return FIRST_KG;
    return last.ok ? last.kg + 5 : last.kg;
  }

  var pick = FIRST_KG;
  function beginTurn() {
    var p = currentPlayer();
    pick = Math.max(minKg(p), defaultKg(p));
    newAttempt(pick);
    ui.hudDot.style.background = p.color;
    ui.hudName.textContent = p.name;
    ui.hudAttempt.textContent = currentRound() + '/3차 시기';
    var b = best(p);
    ui.hudBest.textContent = b == null ? '' : '최고 ' + b + 'kg';
    ui.introTurn.textContent = currentRound() + '/3차 시기' + (match.players.length > 1 ? ' · ' + (match.turn % match.players.length + 1) + '번째 선수' : '');
    ui.introName.textContent = p.name;
    ui.introName.style.color = p.color;
    ui.result.classList.add('hidden');
    ui.intro.classList.remove('hidden');
    hideBanner();
    renderPick();
    updateHud();
  }

  function renderPick() {
    var p = currentPlayer();
    var lo = minKg(p);
    pick = Math.max(lo, Math.min(MAX_KG, pick));
    ui.pickKg.textContent = pick;
    var last = p.attempts[p.attempts.length - 1];
    ui.pickHint.textContent = !last ? '처음 무게를 정하세요 (세계기록 ' + WORLD_RECORD + 'kg)'
      : last.ok ? '지난 시기 ' + last.kg + 'kg 성공 → ' + lo + 'kg 이상'
      : '지난 시기 ' + last.kg + 'kg 실패 → 같은 무게 이상';
    ui.intro.querySelectorAll('[data-d]').forEach(function (b) {
      var d = +b.dataset.d;
      b.disabled = pick + d < lo || pick + d > MAX_KG;
    });
    s.kg = pick;
    ui.kg.textContent = pick;
  }

  ui.intro.addEventListener('click', function (e) {
    var b = e.target.closest('[data-d]');
    if (!b) return;
    pick += +b.dataset.d;
    renderPick();
  });

  ui.introGo.addEventListener('click', function () {
    SO.enterGameMode();
    ui.intro.classList.add('hidden');
    newAttempt(pick);
    startGauge('clean');
    showBanner('클린!', false);
    setTimeout(function () { if (ui.banner.textContent === '클린!') hideBanner(); }, 700);
  });

  function startGauge(phase) {
    s.phase = phase;
    s.t = 0;
    if (phase === 'jerk') { s.freq *= 1.3; s.width *= 0.8; }
    s.center = 0.45 + Math.random() * 0.35;
    s.needle = 0;
  }

  // ---- 입력 ----
  function padDown(side) {
    if (s.phase === 'clean' || s.phase === 'jerk') return liftTap();
    if (s.phase === 'hold') { s[side] = true; SO.vibrate(10); }
  }
  function padUp(side) { s[side] = false; }

  function liftTap() {
    var err = Math.abs(s.needle - s.center);
    var half = s.width / 2;
    if (err > half) {
      fail(s.phase === 'clean' ? '클린 실패 — 바를 어깨로 받지 못했어요' : '저크 실패 — 머리 위로 밀어 올리지 못했어요');
      return;
    }
    var q = 1 - err / half;
    s.q.push(q);
    SO.sound.noise(0.15, 0.45, 500);
    SO.sound.beep(q > 0.8 ? 1100 : 700, 0.08, 'sine', 0.15);
    SO.vibrate(q > 0.8 ? [30, 20, 30] : 30);
    if (s.phase === 'clean') {
      moveBar(BAR_Y.rack);
      s.phase = 'rack';
      s.t = 0;
      showBanner(q > 0.8 ? '완벽한 클린!' : '클린 성공', false);
    } else {
      moveBar(BAR_Y.over);
      s.phase = 'hold';
      s.t = 0;
      s.holdT = 0;
      // 저크가 부정확할수록 처음부터 기울어진 채로 올라감
      s.tilt = (Math.random() < 0.5 ? -1 : 1) * ((1 - q) * 6 + Math.random() * 1.2);
      s.omega = 0;
      showBanner('버텨요!', false);
    }
  }

  function moveBar(y) {
    s.barFrom = s.barY;
    s.barTo = y;
    s.barK = 0;
  }

  [['left', ui.leftBtn], ['right', ui.rightBtn]].forEach(function (pair) {
    var side = pair[0], btn = pair[1];
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      btn.classList.add('push');
      padDown(side);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) {
      btn.addEventListener(ev, function () { btn.classList.remove('push'); padUp(side); });
    });
  });
  document.addEventListener('contextmenu', function (e) { if (!ui.game.classList.contains('hidden')) e.preventDefault(); });

  // 키보드 (PC 테스트용): ← → (스페이스 = 들기)
  document.addEventListener('keydown', function (e) {
    if (!match || ui.game.classList.contains('hidden') || e.repeat) return;
    if (e.code === 'ArrowLeft') padDown('left');
    if (e.code === 'ArrowRight') padDown('right');
    if (e.code === 'Space') { e.preventDefault(); padDown('left'); }
  });
  document.addEventListener('keyup', function (e) {
    if (e.code === 'ArrowLeft' || e.code === 'Space') padUp('left');
    if (e.code === 'ArrowRight') padUp('right');
  });

  function fail(reason) {
    s.phase = 'fail';
    s.t = 0;
    s.ok = false;
    s.reason = reason;
    s.lights = [false, false, false];
    moveBar(BAR_Y.floor);
    showBanner('노 리프트', true);
    SO.sound.beep(140, 0.6, 'sawtooth', 0.22);
    SO.sound.noise(0.4, 0.6, 300);
    SO.vibrate([80, 40, 120]);
  }

  function goodLift() {
    s.phase = 'good';
    s.t = 0;
    s.ok = true;
    s.lights = [true, true, true];
    showBanner('굿 리프트!', false);
    SO.sound.beep(620, 0.45, 'square', 0.18); // 다운 신호
    SO.sound.noise(2, 0.3, 2200);
    SO.vibrate([40, 40, 40]);
  }

  // ---- 진행 ----
  function gaussian() { return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()); }

  function update(dt) {
    s.t += dt;
    // 바벨 위치 이동 (부드럽게)
    if (s.barK < 1) {
      s.barK = Math.min(1, s.barK + dt / (s.barTo < s.barFrom ? 0.45 : 0.35));
      var e = 1 - Math.pow(1 - s.barK, 3);
      s.barY = s.barFrom + (s.barTo - s.barFrom) * e;
    }
    switch (s.phase) {
      case 'clean':
      case 'jerk': {
        var ph = (s.t * s.freq) % 2;
        s.needle = ph < 1 ? ph : 2 - ph;
        if (s.t > STAGE_TIMEOUT) fail('시간 초과');
        break;
      }
      case 'rack':
        if (s.t > 0.9) {
          startGauge('jerk');
          showBanner('저크!', false);
          setTimeout(function () { if (ui.banner.textContent === '저크!') hideBanner(); }, 600);
        }
        break;
      case 'hold': {
        if (s.barK < 1) break; // 다 올라간 뒤부터
        if (s.t > 0.8 && ui.banner.textContent === '버텨요!') hideBanner();
        // 거꾸로 세운 막대: 기울수록 더 기울어짐. 왼쪽 버튼 = 왼쪽 들어 올리기 (기울기 + = 왼쪽이 내려감)
        var u = (s.left ? 1 : 0) - (s.right ? 1 : 0);
        s.omega += (s.instab * s.tilt + gaussian() * s.noise - u * TORQUE - DAMPING * s.omega) * dt;
        s.tilt += s.omega * dt;
        s.holdT += dt;
        if (Math.abs(s.tilt) > TILT_LIMIT) fail('균형을 잃고 바벨을 떨어뜨렸어요');
        else if (s.holdT >= HOLD_TIME) goodLift();
        break;
      }
      case 'good':
        if (s.t > 1.2 && s.barTo !== BAR_Y.floor) moveBar(BAR_Y.floor); // 다운 신호 후 내려놓기
        if (s.t > 2.4) showResult();
        break;
      case 'fail':
        s.tilt *= 1 - dt * 3;
        if (s.t > 2) showResult();
        break;
    }
  }

  // ---- 결과 / 순위 ----
  function best(p) {
    var b = null;
    p.attempts.forEach(function (a) { if (a.ok && (b == null || a.kg > b)) b = a.kg; });
    return b;
  }
  function fails(p) { return p.attempts.filter(function (a) { return !a.ok; }).length; }
  function compare(a, b) {
    var ba = best(a), bb = best(b);
    if (ba !== bb) return (bb == null ? -1 : bb) - (ba == null ? -1 : ba);
    return fails(a) - fails(b);
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
      var marks = r.p.attempts.map(function (a) { return a.kg + (a.ok ? '✓' : '✗'); }).join(' · ');
      return '<tr class="' + (r.p === highlight ? 'me' : '') + '">' +
        '<td class="rank">' + (b == null ? '-' : medal(r.rank)) + '</td>' +
        '<td><span style="color:' + r.p.color + '">●</span> ' + esc(r.p.name) +
        (withMarks && marks ? '<div class="marks">' + marks + '</div>' : '') + '</td>' +
        '<td class="num">' + (b == null ? (r.p.attempts.length ? '기록 없음' : '-') : b + ' kg') + '</td></tr>';
    }).join('');
  }

  function grade(q) { return q == null ? '-' : q > 0.8 ? '완벽' : q > 0.4 ? '좋음' : '아슬아슬'; }

  function showResult() {
    if (s.phase === 'result') return;
    var ok = s.ok;
    s.phase = 'result';
    hideBanner();
    var p = currentPlayer();
    var prevBest = best(p);
    p.attempts.push({ kg: s.kg, ok: ok });

    ui.resKg.classList.toggle('foul', !ok);
    ui.resKg.textContent = (ok ? '✓ ' : '✗ ') + s.kg + ' kg';
    ui.resBadge.textContent = ok && s.kg > WORLD_RECORD ? '🌍 세계 신기록!' : '개인 최고!';
    ui.resBadge.classList.toggle('hidden', !(ok && (s.kg > WORLD_RECORD || (prevBest != null && s.kg > prevBest))));
    var lines = [ok ? '굿 리프트!' : s.reason];
    if (s.q.length) lines.push('클린 ' + grade(s.q[0]) + (s.q.length > 1 ? ' · 저크 ' + grade(s.q[1]) : ''));
    ui.resDetail.innerHTML = lines.map(esc).join('<br>');
    ui.resTable.innerHTML = rankingRows(p, true);

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
    startMatch(match.players);
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
    var ph = s.phase;
    var gauge = ph === 'clean' || ph === 'jerk';
    var hold = ph === 'hold';
    var stepText = { intro: '대기', clean: '① 클린', rack: '숨 고르기', jerk: '② 저크', hold: '③ 버티기', good: '굿 리프트', fail: '실패', result: ok() }[ph] || '';
    function ok() { return s.ok ? '굿 리프트' : '실패'; }
    // 바늘·기울기는 매 프레임 갱신
    if (gauge) ui.needle.style.left = (s.needle * 100) + '%';
    if (hold) {
      ui.tilt.style.left = (50 - Math.max(-1, Math.min(1, s.tilt / TILT_LIMIT)) * 50) + '%';
      ui.holdFill.style.width = Math.min(100, s.holdT / HOLD_TIME * 100) + '%';
    }
    var key = [ph, s.kg, stepText, s.width.toFixed(3), s.center.toFixed(3)].join('|');
    if (key === lastHud) return;
    lastHud = key;
    ui.kg.textContent = s.kg;
    ui.step.textContent = stepText;
    ui.gauge.classList.toggle('hidden', !gauge);
    ui.balance.classList.toggle('hidden', !hold);
    ui.zone.style.left = ((s.center - s.width / 2) * 100) + '%';
    ui.zone.style.width = (s.width * 100) + '%';
    var active = gauge || hold;
    [ui.leftBtn, ui.rightBtn].forEach(function (b) {
      b.classList.toggle('off', !active);
      b.classList.toggle('side', hold);
    });
    ui.leftText.textContent = hold ? '◀ 왼쪽 들기' : '들기!';
    ui.rightText.textContent = hold ? '오른쪽 들기 ▶' : '들기!';
    ui.leftIcon.textContent = hold ? '⤴' : '🏋️';
    ui.rightIcon.textContent = hold ? '⤴' : '🏋️';
  }

  // ---- 그리기 (정면에서 본 모습) ----
  var W = 0, H = 0, DPR = 1, PPM = 100, FLOOR = 0;
  function resize() {
    var r = ui.stage.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    ui.canvas.width = Math.round(W * DPR);
    ui.canvas.height = Math.round(H * DPR);
    PPM = Math.min(W / 2.5, (H - 170) / 2.7);
    FLOOR = H * 0.9;
  }
  window.addEventListener('resize', resize);

  function px(x) { return W / 2 + x * PPM; }
  function py(y) { return FLOOR - y * PPM; }

  // 바벨 높이에 따른 자세 (정면): 바닥 → 어깨 → 머리 위
  var POSES = {
    floor: { hip: 0.62, sh: 1.05, head: 1.24, knee: [0.38, 0.42], foot: 0.25, elbow: null },
    rack: { hip: 0.95, sh: 1.42, head: 1.64, knee: [0.2, 0.48], foot: 0.22, elbow: [0.36, 1.28] },
    over: { hip: 0.88, sh: 1.4, head: 1.6, knee: [0.32, 0.44], foot: 0.34, elbow: [0.44, 1.78] },
  };
  function lerp(a, b, k) { return a + (b - a) * k; }
  function poseFor(barY) {
    var a, b, k;
    if (barY <= BAR_Y.rack) { a = POSES.floor; b = POSES.rack; k = (barY - BAR_Y.floor) / (BAR_Y.rack - BAR_Y.floor); }
    else { a = POSES.rack; b = POSES.over; k = (barY - BAR_Y.rack) / (BAR_Y.over - BAR_Y.rack); }
    k = Math.max(0, Math.min(1, k));
    var ea = a.elbow || [0.4, (a.sh + barY) / 2], eb = b.elbow || [0.4, (b.sh + barY) / 2];
    return {
      hip: lerp(a.hip, b.hip, k), sh: lerp(a.sh, b.sh, k), head: lerp(a.head, b.head, k),
      knee: [lerp(a.knee[0], b.knee[0], k), lerp(a.knee[1], b.knee[1], k)], foot: lerp(a.foot, b.foot, k),
      elbow: [lerp(ea[0], eb[0], k), lerp(ea[1], eb[1], k)],
    };
  }

  function draw(time) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // 배경: 어두운 경기장 + 조명
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0f172a');
    bg.addColorStop(1, '#1e293b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    var spot = ctx.createRadialGradient(W / 2, FLOOR - PPM * 1.2, PPM * 0.2, W / 2, FLOOR - PPM * 1.2, PPM * 2.2);
    spot.addColorStop(0, 'rgba(255,255,220,0.22)');
    spot.addColorStop(1, 'rgba(255,255,220,0)');
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, W, H);
    // 관중 실루엣
    var cheer = s.phase === 'good' ? 1 : 0.2;
    ctx.fillStyle = '#334155';
    for (var i = 0; i < 26; i++) {
      var cx = (i + 0.5) * W / 26;
      var bob = Math.sin(time / 120 + i * 1.7) * 4 * cheer;
      ctx.beginPath();
      ctx.arc(cx, FLOOR - PPM * 2.55 + bob + (i % 2) * 8, W / 60, 0, 6.283);
      ctx.fill();
    }
    // 플랫폼 (나무)
    ctx.fillStyle = '#92400e';
    ctx.fillRect(px(-1.4), FLOOR, 2.8 * PPM, H - FLOOR);
    ctx.fillStyle = '#b45309';
    ctx.fillRect(px(-0.6), FLOOR, 1.2 * PPM, H - FLOOR);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(px(-1.4), FLOOR, 2.8 * PPM, 3);

    drawLifter(match.players[match.turn % match.players.length].color);
    drawLights();
  }

  function drawLights() {
    var y = py(2.5);
    for (var i = 0; i < 3; i++) {
      var x = W / 2 + (i - 1) * 34;
      ctx.fillStyle = s.lights == null ? '#334155' : s.lights[i] ? '#f8fafc' : '#ef4444';
      if (s.lights) { ctx.shadowColor = s.lights[i] ? '#fff' : '#ef4444'; ctx.shadowBlur = 16; }
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, 6.283);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawLifter(color) {
    var pz = poseFor(s.barY);
    var tiltRad = -s.tilt * Math.PI / 180; // 기울기 + = 왼쪽이 내려감
    var cos = Math.cos(tiltRad), sin = Math.sin(tiltRad);
    var barPt = function (bx) { return [bx * cos, s.barY - bx * sin]; }; // 바 위 점 (m)
    var line = function (pts, w, col) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w * PPM;
      ctx.beginPath();
      ctx.moveTo(px(pts[0][0]), py(pts[0][1]));
      for (var i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i][0]), py(pts[i][1]));
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var skin = '#e6b38c';
    // 다리
    [-1, 1].forEach(function (sd) {
      line([[sd * 0.12, pz.hip], [sd * pz.knee[0], pz.knee[1]], [sd * pz.foot, 0.02]], 0.11, skin);
      ctx.fillStyle = '#111827';
      ctx.fillRect(px(sd * pz.foot) - 0.07 * PPM, py(0.04), 0.14 * PPM, 0.05 * PPM);
    });
    // 몸통 (경기복) + 벨트
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(px(-0.2), py(pz.sh));
    ctx.lineTo(px(0.2), py(pz.sh));
    ctx.lineTo(px(0.15), py(pz.hip - 0.05));
    ctx.lineTo(px(-0.15), py(pz.hip - 0.05));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(px(-0.16), py(pz.hip + 0.12), 0.32 * PPM, 0.07 * PPM);
    // 머리
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(px(0), py(pz.head), 0.12 * PPM, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = '#1f2937';
    ctx.beginPath();
    ctx.arc(px(0), py(pz.head + 0.03), 0.12 * PPM, Math.PI, 0);
    ctx.fill();
    // 팔: 어깨 → 팔꿈치 → 바를 잡은 손
    var grip = s.barY > BAR_Y.rack + 0.1 ? 0.55 : 0.3 + (s.barY < 0.6 ? 0.12 : 0);
    [-1, 1].forEach(function (sd) {
      var hand = barPt(sd * grip);
      line([[sd * 0.2, pz.sh], [sd * pz.elbow[0] + (hand[0] - sd * grip) * 0.5, pz.elbow[1] + (hand[1] - s.barY) * 0.5], hand], 0.09, skin);
    });
    drawBarbell(cos, sin);
  }

  function drawBarbell(cos, sin) {
    ctx.save();
    ctx.translate(px(0), py(s.barY));
    ctx.rotate(Math.atan2(sin, cos));
    // 봉
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(-1.1 * PPM, -0.014 * PPM, 2.2 * PPM, 0.028 * PPM);
    // 원판 (양쪽 대칭)
    var perSide = Math.max(0, (s.kg - 25) / 2);
    var stack = [];
    PLATES.forEach(function (pl) {
      while (perSide >= pl[0] - 1e-6) { stack.push(pl); perSide -= pl[0]; }
    });
    [-1, 1].forEach(function (sd) {
      var x = 0.66;
      stack.forEach(function (pl) {
        var h = pl[1] * PPM, w = pl[2] * PPM;
        ctx.fillStyle = pl[3];
        ctx.fillRect(sd > 0 ? x * PPM : -x * PPM - w, -h / 2, w, h);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sd > 0 ? x * PPM : -x * PPM - w, -h / 2, w, h);
        x += pl[2] + 0.002;
      });
      // 고정 칼라
      ctx.fillStyle = '#94a3b8';
      var cw = 0.03 * PPM;
      ctx.fillRect(sd > 0 ? x * PPM : -x * PPM - cw, -0.04 * PPM, cw, 0.08 * PPM);
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
  window.Weightlifting = {
    state: function () { return s; },
    match: function () { return match; },
    setPick: function (kg) { pick = kg; renderPick(); },
    constants: { TILT_LIMIT: TILT_LIMIT },
  };

  SO.registerSW('../../sw.js');
  startSetup();
})();
