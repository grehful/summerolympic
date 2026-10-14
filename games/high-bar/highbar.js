/*
 * 철봉
 *
 * 1. 킥: 몸이 맨 아래를 지날 때 탭하면 반동이 붙는다. 크게 흔들다가 한 바퀴를 넘기면 대회전
 * 2. 손 놓기: 금색 구간(맨 위)에서 놓으면 놓았다 잡기 — 위로 솟았다가 돌아오는 바를 잡기 버튼으로 잡는다
 *    초록 구간(앞으로 올라가는 쪽)에서 놓으면 내리기 — 멀리 날아가 매트에 착지
 * 3. 공중에서 웅크리기를 누르는 동안 빨리 돈다 (떼면 몸을 펴서 천천히). 잡을 땐 처음 자세(물구나무), 착지할 땐 발이 아래
 * 4. 점수 = 난도 D(대회전·놓았다 잡기·내리기 공중돌기) + 실시 E(10점 감점제: 잡기 타이밍, 착지, 낙하)
 */
(function () {
  'use strict';

  // ---- 튜닝 값 ----
  var G = 9.81;
  var L = 1.15;             // 흔들림 계산용 진자 길이 (m)
  var LC = 1.03;            // 바에서 몸 중심까지 거리 (m)
  var HANG = 2.03;          // 바에서 발끝까지 (m)
  var BAR_H = 2.8;          // 바 높이 (m)
  var DAMP = 0.06;          // 공기·마찰 저항
  var OM_MAX = 7.5;         // 최대 회전 속도 (rad/s)
  var PUMP = 1.2;           // 퍼펙트 킥 한 번에 붙는 속도
  var KICK = [              // 맨 아래에서 벗어난 각도 → 킥 효과
    { lim: 10, q: 1, label: '퍼펙트 킥!', cls: 'perfect' },
    { lim: 30, q: 0.7, label: '좋아요', cls: 'good' },
    { lim: 55, q: 0.4, label: '아쉬워요', cls: 'ok' },
  ];
  var RZ = 35;              // 놓았다 잡기 구간: 맨 위 ±35°
  var DZ = [20, 110];       // 내리기 구간: 아래를 지나 앞으로 20°~110°
  var VY_K = 0.95;          // 놓았다 잡기 솟구치는 속도 = 회전 속도 × 이 값
  var DRIFT = 0.7;          // 놓는 타이밍이 맨 위에서 벗어난 만큼 옆으로 흘러감
  var OPEN_RATE = 0.5;      // 공중 회전 속도 (rad/s, 몸 폄)
  var TUCK_RATE = 9;        // 공중 회전 속도 (rad/s, 웅크림)
  var CATCH_Y = 0.35;       // 바를 잡을 수 있는 높이 범위 (m)
  var CATCH_DX = 0.32;      // 바와 옆으로 벗어나도 되는 거리 (m)
  var CATCH_ORI = 40;       // 잡을 때 자세 허용 각도 (°)
  var LAND_OK = 60;         // 착지 허용 각도 (°)
  var COM_STAND = 1.0;      // 서 있을 때 몸 중심 높이
  var TIME_LIMIT = 45;
  var FALL_DED = 1.5;
  var TIMEOUT_DED = 3.0;

  var SO = window.SO;
  var $ = function (id) { return document.getElementById(id); };
  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;

  var ui = {
    setup: $('setup'), game: $('game'), final: $('final'),
    hudDot: $('hudDot'), hudName: $('hudName'), hudAttempt: $('hudAttempt'), hudBest: $('hudBest'),
    stage: $('stage'), canvas: $('canvas'),
    speed: $('speed'), skill: $('skill'), timeChip: $('timeChip'), scoreChip: $('scoreChip'), hint: $('hint'),
    timing: $('timing'), banner: $('banner'),
    intro: $('intro'), introTurn: $('introTurn'), introName: $('introName'), introGo: $('introGo'),
    result: $('result'), resScore: $('resScore'), resBadge: $('resBadge'), resDetail: $('resDetail'),
    resTable: $('resTable'), resNext: $('resNext'),
    kickBtn: $('kickBtn'), kickIcon: $('kickIcon'), kickText: $('kickText'), kickSub: $('kickSub'),
    gripBtn: $('gripBtn'), gripIcon: $('gripIcon'), gripText: $('gripText'), gripSub: $('gripSub'),
    finalTable: $('finalTable'), againBtn: $('againBtn'), setupBtn: $('setupBtn'),
  };
  var ctx = ui.canvas.getContext('2d');

  // ---- 경기 진행 상태 ----
  var match = null;   // { players: [{name,color,routines:[{total,D,E,...}]}], attempts, turn }
  var s = null;

  function currentPlayer() { return match.players[match.turn % match.players.length]; }
  function currentRound() { return Math.floor(match.turn / match.players.length) + 1; }
  function totalTurns() { return match.players.length * match.attempts; }

  function newRoutine() {
    s = {
      phase: 'intro',     // intro → bar ⇄ flight → landed | fallen | timeout → result
      t: 0, now: 0, endT: 0,
      th: 0, om: 0,       // 바에서의 몸 각도(0 = 매달림, π = 물구나무), 회전 속도
      topIdx: 0, giants: 0,
      kickT: -1,
      fl: null,           // 공중 { kind: release|dismount|fall, x, y, vx, vy, phi, phi0, om, x0, y0, t }
      tuck: false,
      releases: [],       // { saltos, ok }
      dismount: null,     // { saltos, err, stick, fall }
      catchDed: 0, landDed: 0, falls: 0, timeout: false,
      camX: 0, camY: 0,
      lie: 0,
    };
  }

  // ---- 화면 전환 ----
  function show(el) {
    [ui.setup, ui.game, ui.final].forEach(function (x) { x.classList.toggle('hidden', x !== el); });
  }

  function startSetup() {
    show(ui.setup);
    SO.setupPlayers(ui.setup, {
      title: '🤸‍♂️ 철봉',
      storageKey: 'highbar',
      maxPlayers: 8,
      attemptChoices: [1, 2, 3],
      defaultAttempts: 1,
      attemptLabel: '1인당 연기 수',
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
  var BASE = { PUMP: PUMP, CATCH_DX: CATCH_DX, CATCH_ORI: CATCH_ORI, CATCH_Y: CATCH_Y, LAND_OK: LAND_OK };
  function applyBoost(idx) {
    var k = SO.olympic.k('high-bar', idx);
    PUMP = BASE.PUMP * (1 + 0.12 * k);                // 킥이 셈
    CATCH_DX = BASE.CATCH_DX * (1 + 0.35 * k);        // 잡기 판정이 넉넉
    CATCH_ORI = BASE.CATCH_ORI * (1 + 0.35 * k);
    CATCH_Y = BASE.CATCH_Y * (1 + 0.25 * k);
    LAND_OK = BASE.LAND_OK + 10 * k;                  // 착지 허용 각도
  }

  function beginTurn() {
    applyBoost(match.turn % match.players.length);
    newRoutine();
    var p = currentPlayer();
    ui.hudDot.style.background = p.color;
    ui.hudName.textContent = p.name;
    ui.hudAttempt.textContent = match.attempts > 1 ? currentRound() + '/' + match.attempts + '번째 연기' : '';
    var b = best(p);
    ui.hudBest.textContent = b == null ? '' : '최고 ' + b.toFixed(2);
    ui.introTurn.textContent = (match.attempts > 1 ? currentRound() + '번째 연기' : '연기') + (match.players.length > 1 ? ' · ' + (match.turn % match.players.length + 1) + '번째 선수' : '');
    ui.introTurn.textContent += SO.olympic.introNote('high-bar', match.turn % match.players.length);
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
    SO.sound.unlock();
    ui.intro.classList.add('hidden');
    s.phase = 'bar';
    showBanner('시작!', false);
  });

  // ---- 각도 도우미 ----
  function wrap(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }   // (-π, π]
  function angDiff(a, b) { return Math.abs(wrap(a - b)); }
  function comOnBar() { return { x: LC * Math.sin(s.th), y: BAR_H - LC * Math.cos(s.th) }; }

  // 지금 손을 놓으면 어떤 기술이 되나
  function zone() {
    if (s.phase !== 'bar') return null;
    var w = wrap(s.th);
    if (s.giants >= 1 && Math.abs(w) >= Math.PI - RZ * DEG) return 'release';
    var dw = w * (s.om >= 0 ? 1 : -1) / DEG;
    if (Math.abs(s.om) > 1.5 && dw >= DZ[0] && dw <= DZ[1]) return 'dismount';
    return null;
  }

  // ---- 조작 ----
  ui.kickBtn.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    try { ui.kickBtn.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    if (s.phase === 'bar') kick();
    else if (s.phase === 'flight' && s.fl.kind !== 'fall') s.tuck = true;
  });
  function openUp() { if (s) s.tuck = false; }
  ui.kickBtn.addEventListener('pointerup', openUp);
  ui.kickBtn.addEventListener('pointercancel', openUp);

  ui.gripBtn.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (s.phase === 'bar') letGo();
    else if (s.phase === 'flight' && s.fl.kind === 'release') tryCatch();
  });

  function kick() {
    var w = wrap(s.th);
    s.kickT = s.now;
    if (Math.abs(s.om) < 0.4 && Math.abs(w) < 0.3) {
      // 가만히 매달린 상태: 첫 반동
      s.om += 1.4;
      SO.sound.sweep(200, 320, 0.12, 'triangle', 0.1);
      return;
    }
    var e = Math.abs(w) / DEG;
    for (var i = 0; i < KICK.length; i++) {
      if (e <= KICK[i].lim) {
        s.om += (s.om >= 0 ? 1 : -1) * PUMP * KICK[i].q;
        s.om = Math.max(-OM_MAX, Math.min(OM_MAX, s.om));
        showTiming(KICK[i].label, KICK[i].cls);
        SO.sound.sweep(220 + 140 * KICK[i].q, 380 + 220 * KICK[i].q, 0.12, 'triangle', 0.12);
        SO.vibrate(15);
        return;
      }
    }
    showTiming('타이밍!', 'miss');
    SO.sound.beep(140, 0.08, 'square', 0.06);
  }

  function letGo() {
    var z = zone();
    if (!z) { SO.sound.beep(120, 0.06, 'square', 0.05); return; }
    var c = comOnBar();
    var fl = { kind: z, x: c.x, y: c.y, phi: s.th, phi0: s.th, om: s.om, x0: c.x, y0: c.y, t: 0 };
    if (z === 'release') {
      // 위로 솟구쳤다 돌아옴 (놓는 타이밍이 맨 위에서 벗어난 만큼 옆으로 흘러감)
      var w = wrap(s.th);
      var off = w - (w > 0 ? Math.PI : -Math.PI);
      fl.vx = off * DRIFT;
      fl.vy = VY_K * Math.abs(s.om);
      showBanner('놓았다!', false);
    } else {
      // 내리기: 놓는 순간의 속도 그대로 날아감
      fl.vx = LC * s.om * Math.cos(s.th);
      fl.vy = LC * s.om * Math.sin(s.th);
      showBanner('내리기!', false);
    }
    s.fl = fl;
    s.phase = 'flight';
    s.tuck = false;
    SO.sound.sweep(300, 700, 0.2, 'triangle', 0.12);
  }

  function tryCatch() {
    var fl = s.fl;
    var dy = fl.y - fl.y0;
    if (fl.vy > 0 || dy > CATCH_Y * 1.8) { showTiming('아직!', 'ok'); return; }   // 너무 일찍: 한 번 봐줌
    var dx = Math.abs(fl.x - fl.x0);
    var ori = angDiff(fl.phi, Math.PI) / DEG;
    var saltos = Math.round(Math.abs(fl.phi - fl.phi0) / TAU);
    if (Math.abs(dy) <= CATCH_Y && dx <= CATCH_DX && ori <= CATCH_ORI) {
      var ded = Math.abs(dy) <= 0.12 ? 0 : Math.abs(dy) <= 0.24 ? 0.1 : 0.2;
      s.catchDed += ded + (ori > 25 ? 0.1 : 0);
      s.releases.push({ saltos: saltos, ok: true });
      // 다시 바에 매달림: 자세 그대로, 회전 속도 유지
      s.th = fl.phi;
      s.om = fl.om * 0.95;
      s.topIdx = Math.floor((s.th + Math.PI) / TAU);
      s.phase = 'bar';
      s.fl = null;
      s.tuck = false;
      showBanner(saltos ? (saltos === 1 ? '공중돌기 캐치!' : saltos + '회전 캐치!') : '캐치!', false);
      showTiming(ded === 0 ? '퍼펙트 캐치!' : ded <= 0.1 ? '좋아요' : '아슬아슬', ded === 0 ? 'perfect' : ded <= 0.1 ? 'good' : 'ok');
      SO.sound.beep(660, 0.08, 'square', 0.1);
      SO.sound.beep(990, 0.12, 'triangle', 0.1);
      SO.vibrate(30);
    } else {
      missBar(dx > CATCH_DX ? '바가 멀어요' : ori > CATCH_ORI ? '자세가 틀어졌어요' : '타이밍!');
    }
  }

  function missBar(why) {
    s.releases.push({ saltos: 0, ok: false });
    s.fl.kind = 'fall';
    s.tuck = false;
    s.fallWhy = why;
    showBanner('놓쳤다!', true);
    SO.sound.sweep(500, 120, 0.5, 'sawtooth', 0.12);
    SO.vibrate([80, 50, 120]);
  }

  // ---- 진행 ----
  function update(dt) {
    s.now += dt;
    if (s.phase === 'bar' || s.phase === 'flight') {
      s.t += dt;
      if (s.t >= TIME_LIMIT && s.phase === 'bar') {
        s.timeout = true;
        s.phase = 'timeout';
        s.endT = s.now;
        showBanner('시간 초과', true);
        SO.sound.sweep(400, 150, 0.5, 'sawtooth', 0.1);
      }
    }
    if (s.phase === 'bar') {
      var a = -(G / L) * Math.sin(s.th) - DAMP * s.om;
      s.om += a * dt;
      s.om = Math.max(-OM_MAX, Math.min(OM_MAX, s.om));
      s.th += s.om * dt;
      // 맨 위를 넘을 때마다 대회전 1번
      var ti = Math.floor((s.th + Math.PI) / TAU);
      if (ti !== s.topIdx) {
        s.topIdx = ti;
        s.giants++;
        if (s.giants === 1) showBanner('대회전!', false);
        SO.sound.beep(520 + Math.min(8, s.giants) * 40, 0.08, 'triangle', 0.08);
      }
    } else if (s.phase === 'flight') {
      updateFlight(dt);
    } else if (s.phase === 'landed' || s.phase === 'fallen' || s.phase === 'timeout') {
      if (s.phase === 'fallen') s.lie = Math.min(1, s.lie + dt * 4);
      if (s.now - s.endT > 1.8) showResult();
    }
    // 카메라: 몸 중심을 따라감
    var c = s.fl ? { x: s.fl.x, y: s.fl.y } : s.phase === 'bar' ? { x: 0, y: BAR_H } : { x: s.camX, y: BAR_H };
    var tx = Math.abs(c.x) > 1.2 ? c.x - Math.sign(c.x) * 1.2 : 0;
    var ty = Math.max(0, c.y - (BAR_H + 2.2));
    s.camX += (tx - s.camX) * Math.min(1, dt * 4);
    s.camY += (ty - s.camY) * Math.min(1, dt * 4);
  }

  function updateFlight(dt) {
    var fl = s.fl;
    fl.t += dt;
    fl.x += fl.vx * dt;
    fl.vy -= G * dt;
    fl.y += fl.vy * dt;
    if (fl.kind !== 'fall') fl.phi += (fl.om >= 0 ? 1 : -1) * (s.tuck ? TUCK_RATE : OPEN_RATE) * dt;
    else fl.phi += fl.om * 0.5 * dt;
    if (fl.kind === 'release') {
      if (fl.vy < 0 && fl.y < fl.y0 - CATCH_Y) missBar('잡기를 못 눌렀어요');
    } else if (fl.kind === 'dismount') {
      if (fl.vy < 0 && fl.y <= COM_STAND) land();
    } else if (fl.y <= 0.3 && fl.vy < 0) {
      // 낙하: 매트에 떨어짐
      fl.y = 0.3;
      s.falls++;
      s.phase = 'fallen';
      s.endT = s.now;
      SO.sound.noise(0.4, 0.3, 600);
    }
  }

  function land() {
    var fl = s.fl;
    var err = angDiff(fl.phi, 0) / DEG;
    var saltos = Math.round(Math.abs(fl.phi - fl.phi0) / TAU);
    fl.y = COM_STAND;
    s.endT = s.now;
    if (err > LAND_OK) {
      s.dismount = { saltos: saltos, err: err, stick: false, fall: true };
      s.falls++;
      s.phase = 'fallen';
      fl.kind = 'fall';
      fl.y = 0.3;
      showBanner('넘어짐', true);
      SO.sound.noise(0.4, 0.3, 600);
      SO.vibrate([80, 50, 120]);
      return;
    }
    var ded = err <= 15 ? 0 : err <= 30 ? 0.1 : err <= 45 ? 0.3 : 0.5;
    s.landDed += ded;
    s.dismount = { saltos: saltos, err: err, stick: ded === 0, fall: false };
    s.phase = 'landed';
    fl.phi = 0;
    showBanner(ded === 0 ? '스틱!' : ded <= 0.1 ? '착지!' : '휘청', ded > 0.3);
    if (ded > 0.3) setTimeout(hideBanner, 900);
    SO.sound.noise(1.6, ded === 0 ? 0.3 : 0.15, 2200);
    SO.vibrate(40);
  }

  // ---- 점수 ----
  function score() {
    var D = Math.min(s.giants, 6) * 0.2;
    var counted = 0;
    s.releases.forEach(function (r) {
      if (r.ok && counted < 3) { counted++; D += 0.6 + 0.5 * r.saltos; }
    });
    if (s.dismount) D += 0.3 + 0.5 * s.dismount.saltos;
    var E = 10 - s.catchDed - s.landDed - s.falls * FALL_DED - (s.timeout ? TIMEOUT_DED : 0);
    E = Math.max(0, E);
    return { D: D, E: E, total: D + E };
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
  function saltoName(n) { return n === 0 ? '' : n === 1 ? '공중돌기' : n === 2 ? '더블' : n === 3 ? '트리플' : n + '회전'; }

  function rankingRows(highlight, withMarks) {
    return ranking().map(function (r) {
      var b = best(r.p);
      var marks = r.p.routines.map(function (x) { return x.total.toFixed(2) + (x.falls ? '(낙하)' : ''); }).join(' · ');
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
    p.routines.push({ total: sc.total, D: sc.D, E: sc.E, falls: s.falls, giants: s.giants });

    ui.resScore.classList.toggle('foul', s.falls > 0);
    ui.resScore.textContent = sc.total.toFixed(2) + '점';
    ui.resBadge.classList.toggle('hidden', !(prevBest != null && sc.total > prevBest));
    var ok = s.releases.filter(function (r) { return r.ok; });
    var lines = [
      '난도 D ' + sc.D.toFixed(1) + ' · 실시 E ' + sc.E.toFixed(2),
      '대회전 ' + s.giants + '번 · 놓았다 잡기 ' + ok.length + '번' + (ok.length ? ' (' + ok.map(function (r) { return saltoName(r.saltos) || '기본'; }).join(', ') + ')' : ''),
    ];
    if (s.dismount) {
      lines.push('내리기: ' + (saltoName(s.dismount.saltos) || '기본') + ' · ' +
        (s.dismount.fall ? '넘어짐' : s.dismount.stick ? '스틱!' : '착지 ' + Math.round(s.dismount.err) + '° 틀어짐'));
    }
    if (s.releases.some(function (r) { return !r.ok; })) lines.push('바를 놓쳐 떨어졌어요 (' + (s.fallWhy || '') + ') — 실시 -' + FALL_DED);
    if (s.timeout) lines.push('45초 안에 내려오지 못했어요 (실시 -' + TIMEOUT_DED + ')');
    ui.resDetail.innerHTML = lines.map(esc).join('<br>');
    ui.resTable.innerHTML = match.players.length > 1 ? rankingRows(p, false) : '';

    var last = match.turn + 1 >= totalTurns();
    if (last) ui.resNext.textContent = '최종 결과 보기';
    else {
      var np = match.players[(match.turn + 1) % match.players.length];
      ui.resNext.textContent = match.players.length > 1 ? '다음: ' + np.name : '다음 연기';
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
    SO.olympic.onFinal('high-bar', ranking().map(function (r) {
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
    timingTimer = setTimeout(function () { ui.timing.classList.add('hidden'); }, 600);
  }

  var lastHud = '';
  function updateHud() {
    var bar = s.phase === 'bar';
    var fl = s.phase === 'flight' ? s.fl : null;
    var z = zone();
    var om = bar ? s.om : fl ? fl.om : 0;
    var speed = Math.round(Math.abs(om) * HANG * 3.6);
    var skill = fl ? (fl.kind === 'release' ? '놓고 잡기' : fl.kind === 'dismount' ? '내리기' : '낙하')
      : s.phase === 'landed' ? '착지' : s.giants ? '대회전 ' + s.giants : s.phase === 'intro' ? '준비' : '흔들기';
    var turns = fl && fl.kind !== 'fall' ? Math.abs(fl.phi - fl.phi0) / TAU : 0;
    if (fl && fl.kind !== 'fall') skill += ' ' + turns.toFixed(1);
    var left = Math.max(0, TIME_LIMIT - s.t);
    var timeText = s.phase === 'intro' ? '' : '⏱ ' + Math.ceil(left) + '초';
    var sc = score();
    var scoreText = sc.D > 0 ? 'D ' + sc.D.toFixed(1) : '';
    var catchable = fl && fl.kind === 'release' && fl.vy < 0 && Math.abs(fl.y - fl.y0) <= CATCH_Y;
    var hot = bar && Math.abs(wrap(s.th)) < 25 * DEG;
    var hint = bar ? (s.giants ? '금색 구간에서 손 놓기 = 놓았다 잡기 · 초록 구간 = 내리기' : '맨 아래를 지날 때 킥! 크게 흔들어 한 바퀴 넘기기')
      : fl && fl.kind === 'release' ? '웅크리기로 돌고, 물구나무 자세로 바에 오면 잡기!'
      : fl && fl.kind === 'dismount' ? '웅크려 돌다가 발이 아래로 올 때 펴기' : '';
    var key = [s.phase, speed, skill, timeText, scoreText, z, catchable, hot, s.tuck, hint, left < 10].join('|');
    if (key === lastHud) return;
    lastHud = key;
    ui.speed.textContent = speed;
    ui.skill.textContent = skill;
    ui.timeChip.textContent = timeText;
    ui.timeChip.classList.toggle('low', left < 10 && s.phase === 'bar');
    ui.scoreChip.textContent = scoreText;
    ui.hint.textContent = hint;
    var air = !!fl && fl.kind !== 'fall';
    ui.kickBtn.classList.toggle('hot', hot && !air);
    ui.kickBtn.classList.toggle('tuck', air && s.tuck);
    ui.kickIcon.textContent = air ? '🌀' : '🦵';
    ui.kickText.textContent = air ? '웅크리기' : '킥';
    ui.kickSub.textContent = air ? '누르는 동안 빨리 돌아요' : '아래 지날 때 탭';
    ui.gripBtn.classList.toggle('gold', z === 'release' || catchable);
    ui.gripBtn.classList.toggle('green', z === 'dismount');
    ui.gripIcon.textContent = fl && fl.kind === 'release' ? '🤲' : '✋';
    ui.gripText.textContent = fl && fl.kind === 'release' ? '잡기' : '손 놓기';
    ui.gripSub.textContent = fl && fl.kind === 'release' ? (catchable ? '지금!' : '바가 오면 탭') : z === 'release' ? '놓았다 잡기' : z === 'dismount' ? '내리기' : '색 구간에서';
  }

  // ---- 그리기 ----
  var W = 0, H = 0, DPR = 1, PPM = 60, GROUND = 0;
  function resize() {
    var r = ui.stage.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    ui.canvas.width = Math.round(W * DPR);
    ui.canvas.height = Math.round(H * DPR);
    var top = W > H * 1.3 ? 70 : 120;
    PPM = Math.min(W / 5.6, (H - top - 30) / 5.0);
    GROUND = H - 30;
  }
  window.addEventListener('resize', resize);
  function sx(x) { return W / 2 + (x - s.camX) * PPM; }
  function sy(y) { return GROUND - (y - s.camY) * PPM; }

  function draw(time) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b1a33');
    bg.addColorStop(1, '#1e3a5f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // 관중
    ctx.fillStyle = '#334155';
    var cheer = s.phase === 'landed' ? 1 : 0.15;
    for (var ci = 0; ci < 30; ci++) {
      var cxp = ((ci + 0.5) * W / 30 - s.camX * PPM * 0.3) % W;
      if (cxp < 0) cxp += W;
      ctx.beginPath();
      ctx.arc(cxp, sy(1.6) - (ci % 3) * 12 + Math.sin(time / 130 + ci) * 4 * cheer, Math.min(W / 70, 7), 0, TAU);
      ctx.fill();
    }
    // 바닥 + 매트
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, sy(0), W, H);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(sx(-8), sy(0.2), 16 * PPM, 0.2 * PPM + 2);
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(sx(-8), sy(0.2), 16 * PPM, 3);
    // 거리 눈금 (매트)
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (var m = -7; m <= 7; m++) { if (!m) continue; ctx.fillRect(sx(m) - 1, sy(0.2) - 5, 2, 5); ctx.fillText(Math.abs(m) + 'm', sx(m), sy(0.2) - 9); }
    // 기둥 + 바
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(sx(0), sy(0.2));
    ctx.lineTo(sx(0), sy(BAR_H));
    ctx.stroke();
    ctx.strokeStyle = 'rgba(148,163,184,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx(0), sy(BAR_H)); ctx.lineTo(sx(-2.2), sy(0.2));
    ctx.moveTo(sx(0), sy(BAR_H)); ctx.lineTo(sx(2.2), sy(0.2));
    ctx.stroke();

    drawZones(time);

    ctx.fillStyle = '#e5e7eb';
    ctx.beginPath();
    ctx.arc(sx(0), sy(BAR_H), 5, 0, TAU);
    ctx.fill();

    drawGymnast(time);
  }

  // 손 놓기 구간 표시 (발끝이 지나는 원 위에)
  function drawZones(time) {
    if (s.phase !== 'bar') return;
    var R = (HANG + 0.12) * PPM, bx = sx(0), by = sy(BAR_H);
    ctx.lineCap = 'round';
    // 발끝 궤도
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, by, R, 0, TAU);
    ctx.stroke();
    var z = zone();
    // 캔버스 각도: 몸 각도 θ(0 = 아래, 앞 = +x) → 캔버스 각 = π/2 - θ
    var arc = function (from, to, col, on) {
      ctx.strokeStyle = col;
      ctx.lineWidth = on ? 10 : 6;
      ctx.globalAlpha = on ? 1 : 0.55;
      ctx.beginPath();
      ctx.arc(bx, by, R, Math.PI / 2 - to, Math.PI / 2 - from);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    if (s.giants >= 1) arc(Math.PI - RZ * DEG, Math.PI + RZ * DEG, '#fde047', z === 'release');
    if (Math.abs(s.om) > 1.5) {
      var d = s.om >= 0 ? 1 : -1;
      var a1 = DZ[0] * DEG * d, a2 = DZ[1] * DEG * d;
      arc(Math.min(a1, a2), Math.max(a1, a2), '#4ade80', z === 'dismount');
    }
  }

  var STRAIGHT = { hip: 0.95, lean: 0, legs: [[0.02, 0.02], [-0.02, -0.02]], arms: [[Math.PI, Math.PI], [Math.PI - 0.05, Math.PI - 0.05]] };
  var TUCKED = { hip: 0.95, lean: 0.45, legs: [[2.1, 0.5], [2.0, 0.4]], arms: [[1.6, 0.4], [1.5, 0.3]] };

  function drawGymnast(time) {
    var col = currentPlayer().color;
    var pose, ox, oy, rot, anchorY;
    if (s.phase === 'bar' || s.phase === 'intro' || (s.phase === 'timeout' && !s.fl)) {
      // 바에 매달림: 손이 바, 몸이 θ 방향
      pose = STRAIGHT;
      var since = s.now - s.kickT;
      if (s.kickT >= 0 && since < 0.3) {
        // 킥: 다리를 차는 동작
        var k = Math.sin(since / 0.3 * Math.PI);
        var dir = s.om >= 0 ? 1 : -1;
        pose = { hip: 0.95, lean: -0.25 * k * dir, legs: [[0.7 * k * dir, 0.3 * k * dir], [0.6 * k * dir, 0.25 * k * dir]], arms: STRAIGHT.arms };
      }
      ox = sx(0); oy = sy(BAR_H); rot = s.th; anchorY = HANG;
    } else if (s.phase === 'landed') {
      pose = { hip: 0.95, lean: -0.1, legs: [[0.15, 0.1], [-0.15, -0.1]], arms: [[2.7, 2.9], [-2.7, -2.9]] };
      ox = sx(s.fl.x); oy = sy(0.2); rot = 0; anchorY = 0;
    } else if (s.phase === 'fallen') {
      pose = { hip: 0.95, lean: 0.1, legs: [[0.3, 0.2], [-0.2, -0.1]], arms: [[1.2, 1.0], [1.0, 0.8]] };
      ox = sx(s.fl.x); oy = sy(0.2 + 0.15); rot = Math.PI / 2 * (s.fl.om >= 0 ? 1 : -1) * s.lie; anchorY = 0.15;
    } else {
      var fl = s.fl;
      pose = s.tuck ? TUCKED : fl.kind === 'release' ? STRAIGHT : { hip: 0.95, lean: 0, legs: STRAIGHT.legs, arms: [[2.4, 2.6], [-2.4, -2.6]] };
      if (fl.kind === 'fall') pose = { hip: 0.95, lean: 0.3, legs: [[0.6, 0.3], [-0.4, -0.2]], arms: [[2.2, 1.8], [-1.5, -1.0]] };
      ox = sx(fl.x); oy = sy(fl.y); rot = fl.phi; anchorY = 1.0;
    }
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(-rot);
    SO.athlete.draw(ctx, pose, {
      x: 0, y: 0,
      toX: function (x) { return x * PPM; },
      toY: function (y) { return (anchorY - y) * PPM; },
      ppm: PPM, color: col,
    });
    ctx.restore();
    // 놓았다 잡기 중: 돌아올 바 위치 안내
    if (s.phase === 'flight' && s.fl.kind === 'release') {
      var ok = s.fl.vy < 0 && Math.abs(s.fl.y - s.fl.y0) <= CATCH_Y;
      ctx.strokeStyle = ok ? '#fde047' : 'rgba(253,224,71,0.35)';
      ctx.lineWidth = ok ? 4 : 2;
      ctx.beginPath();
      ctx.arc(sx(0), sy(BAR_H), 12 + (ok ? Math.sin(time / 60) * 3 : 0), 0, TAU);
      ctx.stroke();
    }
  }

  // ---- 메인 루프 ----
  var prev = 0;
  function frame(time) {
    var dt = Math.min(0.05, (time - prev) / 1000 || 0);
    prev = time;
    if (match && s && !ui.game.classList.contains('hidden')) {
      if (s.phase !== 'intro' && s.phase !== 'result') {
        // 빠른 회전도 정확하게: 작은 단계로 나눠 계산
        var n = Math.ceil(dt / 0.005);
        for (var i = 0; i < n; i++) update(dt / n);
      }
      updateHud();
      draw(time);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 테스트/디버그용
  window.HighBar = {
    state: function () { return s; },
    match: function () { return match; },
    zone: function () { return zone(); },
    wrap: wrap,
    score: function () { return score(); },
  };

  SO.registerSW('../../sw.js');
  if (SO.olympic.active()) SO.olympic.start('high-bar', startMatch);
  else startSetup();
})();
