/*
 * 평균대
 *
 * 1. 선수는 평균대 위를 천천히 걸어간다. 몸은 계속 앞뒤로 기우뚱 (거꾸로 선 진자처럼 불안정)
 *    아래 균형 패드를 기울어지는 반대쪽으로 끌어 버틴다 (옵션: 폰 기울이기). 30° 넘으면 떨어짐
 * 2. 경기 화면 스와이프로 기술: ↑ 점프, → 다리 찢어 뛰기, ↓ 뒤 공중돌기, 원 그리기 = 턴 (두 바퀴 = 더블 턴)
 *    공중에서는 균형이 멈춰 있다가 착지할 때 크게 휘청. 착지 후 1.2초 버티면 기술 인정
 * 3. 끝까지 가면 ↑ 스와이프로 내리기 (공중돌기 착지, 그때 균형이 좋을수록 스틱)
 * 4. 점수 = 난도 D(기술 종류별 2번까지) + 실시 E(10점: 흔들림 −0.1, 떨어짐 −1, 착지, 기술 5개 미만이면 1개당 −1)
 */
(function () {
  'use strict';

  // ---- 튜닝 값 ----
  var A = 2.0;              // 넘어지려는 힘 (rad/s² per rad)
  var CTRL = 5.0;           // 패드를 끝까지 끌었을 때 버티는 힘
  var DAMP = 2.0;
  var GUST = 0.8;           // 저절로 흔들리는 세기
  var FALL = 30;            // 떨어지는 각도 (°)
  var WOBBLE = 12;          // 이보다 기울면 흔들림 감점
  var WALK = 0.11;          // 걷는 속도 (m/s)
  var BEAM_LEN = 5.0, BEAM_H = 1.25, START_X = 0.4, END_X = 4.6;
  var HOLD = 1.2;           // 착지 후 이만큼 버텨야 기술 인정
  var REQ = 5;              // 감점 없는 최소 기술 수
  var ELEM = {              // 기술: 이름, 시간, 앞으로 이동, 착지 휘청임, 난도
    jump: { name: '점프', dur: 0.55, dx: 0, kick: 0.55, d: 0.3, air: true },
    leap: { name: '다리 찢어 뛰기', dur: 0.65, dx: 0.7, kick: 0.85, d: 0.5, air: true },
    salto: { name: '뒤 공중돌기', dur: 0.8, dx: -0.3, kick: 1.15, d: 0.8, air: true },
    turn: { name: '턴', dur: 0.55, dx: 0, kick: 0.5, d: 0.4, air: false },
  };
  var MAX_SAME = 2;
  var TIME_LIMIT = 75;      // 이 시간이 지나면 그냥 뛰어내리며 끝

  var SO = window.SO;
  var $ = function (id) { return document.getElementById(id); };
  var TAU = Math.PI * 2, DEG = Math.PI / 180;

  var ui = {
    setup: $('setup'), game: $('game'), final: $('final'),
    hudDot: $('hudDot'), hudName: $('hudName'), hudAttempt: $('hudAttempt'), hudBest: $('hudBest'),
    stage: $('stage'), canvas: $('canvas'),
    lean: $('lean'), skill: $('skill'), scoreChip: $('scoreChip'), reqChip: $('reqChip'), gestureHelp: $('gestureHelp'),
    timing: $('timing'), banner: $('banner'),
    intro: $('intro'), introTurn: $('introTurn'), introName: $('introName'), introGo: $('introGo'), tiltOpt: $('tiltOpt'),
    result: $('result'), resScore: $('resScore'), resBadge: $('resBadge'), resDetail: $('resDetail'),
    resTable: $('resTable'), resNext: $('resNext'),
    balPad: $('balPad'), balNeedle: $('balNeedle'), balKnob: $('balKnob'), balText: $('balText'),
    finalTable: $('finalTable'), againBtn: $('againBtn'), setupBtn: $('setupBtn'),
  };
  var ctx = ui.canvas.getContext('2d');

  // ---- 경기 진행 상태 ----
  var match = null;   // { players: [{name,color,routines:[{total,D,E,falls}]}], attempts, turn }
  var s = null;

  function currentPlayer() { return match.players[match.turn % match.players.length]; }
  function currentRound() { return Math.floor(match.turn / match.players.length) + 1; }
  function totalTurns() { return match.players.length * match.attempts; }

  function newRoutine() {
    s = {
      phase: 'intro',     // intro → walk ⇄ fallen → end → dismount → landed → result
      t: 0, now: 0, endT: 0,
      x: START_X, phi: 0, w: 0, gust: 0, gustT: 0,
      el: null,           // 진행 중인 기술 { type, t, turns, x0, phi0 }
      pending: null,      // 착지 후 버티는 중인 기술 { type, turns, t }
      done: [],           // 인정된 기술 [{ type, turns }]
      wobbles: 0, inWobble: false, falls: 0,
      dis: null,          // 내리기 { t, auto, x0 }
      landDed: 0, stick: false, disFall: false, endWait: 0,
      fallT: 0, fallDir: 1,
      camX: 0,
    };
  }

  // ---- 화면 전환 ----
  function show(el) {
    [ui.setup, ui.game, ui.final].forEach(function (x) { x.classList.toggle('hidden', x !== el); });
  }

  function startSetup() {
    show(ui.setup);
    SO.setupPlayers(ui.setup, {
      title: '⚖️ 평균대',
      storageKey: 'beam',
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
  var BASE = { A: A, GUST: GUST, FALL: FALL };
  function applyBoost(idx) {
    var k = SO.olympic.k('beam', idx);
    A = BASE.A * (1 - 0.25 * k);          // 덜 넘어지려 함
    GUST = BASE.GUST * (1 - 0.35 * k);    // 덜 흔들림
    FALL = BASE.FALL + 5 * k;             // 더 기울어도 버팀
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
    ui.introTurn.textContent += SO.olympic.introNote('beam', match.turn % match.players.length);
    ui.introName.textContent = p.name;
    ui.introName.style.color = p.color;
    ui.tiltOpt.checked = tiltOn;
    ui.result.classList.add('hidden');
    ui.intro.classList.remove('hidden');
    ui.timing.classList.add('hidden');
    hideBanner();
    updateHud();
  }

  ui.introGo.addEventListener('click', function () {
    SO.enterGameMode();
    SO.sound.unlock();
    tiltOn = ui.tiltOpt.checked;
    try { localStorage.setItem('so:beam:tilt', tiltOn ? '1' : '0'); } catch (e) { /* 무시 */ }
    tilt0 = null;   // 지금 폰 각도를 기준으로
    ui.intro.classList.add('hidden');
    s.phase = 'walk';
    showBanner('시작!', false);
  });

  // ---- 균형 입력: 패드 + (옵션) 폰 기울기 ----
  var padU = 0, padId = null;
  function padMove(e) {
    var r = ui.balPad.getBoundingClientRect();
    padU = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width * 0.42)));
  }
  ui.balPad.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    padId = e.pointerId;
    try { ui.balPad.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    padMove(e);
  });
  ui.balPad.addEventListener('pointermove', function (e) { if (e.pointerId === padId) padMove(e); });
  function padUp(e) { if (e.pointerId === padId) { padId = null; padU = 0; } }
  ui.balPad.addEventListener('pointerup', padUp);
  ui.balPad.addEventListener('pointercancel', padUp);

  var tiltOn = false, tiltU = 0, tilt0 = null;
  try { tiltOn = localStorage.getItem('so:beam:tilt') === '1'; } catch (e) { /* 무시 */ }
  window.addEventListener('deviceorientation', function (e) {
    if (e.gamma == null) return;
    var ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    // 화면 기준 좌우 기울기
    var v = ang === 90 ? e.beta : ang === -90 || ang === 270 ? -e.beta : e.gamma;
    if (tilt0 == null) tilt0 = v;
    tiltU = Math.max(-1, Math.min(1, (v - tilt0) / 20));
  });
  function input() { return Math.max(-1, Math.min(1, padU + (tiltOn ? tiltU : 0))); }

  // ---- 기술 제스처 (경기 화면) ----
  var gest = null;
  ui.stage.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.panel')) return;
    e.preventDefault();
    gest = { id: e.pointerId, pts: [[e.clientX, e.clientY]] };
    try { ui.stage.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
  });
  ui.stage.addEventListener('pointermove', function (e) {
    if (gest && e.pointerId === gest.id) gest.pts.push([e.clientX, e.clientY]);
  });
  ui.stage.addEventListener('pointerup', function (e) {
    if (!gest || e.pointerId !== gest.id) return;
    gest.pts.push([e.clientX, e.clientY]);
    var g = classify(gest.pts);
    gest = null;
    if (g) onGesture(g);
  });
  ui.stage.addEventListener('pointercancel', function () { gest = null; });

  // 스와이프 방향 또는 원(돌아간 각도) 판정
  function classify(pts) {
    var turn = 0, prev = null;
    for (var i = 1; i < pts.length; i++) {
      var dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
      if (Math.hypot(dx, dy) < 4) continue;
      var h = Math.atan2(dy, dx);
      if (prev != null) { var d = h - prev; d = Math.atan2(Math.sin(d), Math.cos(d)); turn += d; }
      prev = h;
    }
    if (Math.abs(turn) >= 300 * DEG) return { type: 'turn', turns: Math.abs(turn) >= 650 * DEG ? 2 : 1 };
    var ox = pts[pts.length - 1][0] - pts[0][0], oy = pts[pts.length - 1][1] - pts[0][1];
    if (Math.max(Math.abs(ox), Math.abs(oy)) < 35) return null;
    if (Math.abs(oy) > Math.abs(ox)) return { type: oy < 0 ? 'jump' : 'salto' };
    return ox > 0 ? { type: 'leap' } : null;
  }

  function onGesture(g) {
    if (s.phase === 'end') { if (g.type === 'jump') startDismount(false); return; }
    if (s.phase !== 'walk' || s.el) return;
    if (Math.abs(s.phi) > 22 * DEG) { showTiming('균형부터!', 'ok'); return; }
    var e = ELEM[g.type];
    if (g.type === 'leap' && s.x + e.dx > END_X) { showTiming('자리가 없어요', 'ok'); return; }
    s.el = { type: g.type, t: 0, turns: g.turns || 1, x0: s.x, phi0: s.phi };
    s.pending = null;   // 앞 기술은 버티는 중이었다면 이어서 인정
    SO.sound.sweep(300, 600, 0.15, 'triangle', 0.1);
  }

  // ---- 진행 ----
  function update(dt) {
    s.now += dt;
    if (s.phase === 'walk' || s.phase === 'end' || s.phase === 'fallen') s.t += dt;
    if ((s.phase === 'walk' || s.phase === 'end') && s.t >= TIME_LIMIT && !s.el) {
      s.timeout = true;
      showBanner('시간 끝', true);
      setTimeout(hideBanner, 900);
      startDismount(true);
      return;
    }
    if (s.phase === 'walk' || s.phase === 'end') {
      if (s.el) updateElement(dt);
      var air = s.el && ELEM[s.el.type].air;
      if (!air) balance(dt, s.el && s.el.type === 'turn');
      if (!s.el && s.phase === 'walk') {
        s.x += WALK * dt;
        if (s.x >= END_X) {
          s.x = END_X;
          s.phase = 'end';
          s.endWait = 0;
          showBanner('내리기!', false);
        }
      }
      if (s.phase === 'end' && !s.el) {
        s.endWait += dt;
        if (s.endWait > 6) startDismount(true);   // 가만히 있으면 그냥 뛰어내림
      }
      // 착지 후 버티면 기술 인정
      if (s.pending && s.now - s.pending.t >= HOLD) {
        s.done.push({ type: s.pending.type, turns: s.pending.turns });
        showTiming(elemName(s.pending) + ' 성공!', 'good');
        SO.sound.beep(880, 0.08, 'triangle', 0.1);
        s.pending = null;
      }
    } else if (s.phase === 'fallen') {
      s.fallT += dt;
      if (s.fallT > 1.8) {
        // 다시 올라가서 이어서
        s.phase = s.x >= END_X ? 'end' : 'walk';
        s.phi = 0; s.w = 0; s.gust = 0; s.endWait = 0;
        showBanner('다시!', false);
      }
    } else if (s.phase === 'dismount') {
      s.dis.t += dt;
      if (s.dis.t >= s.dis.dur) landDismount();
    } else if (s.phase === 'landed') {
      if (s.now - s.endT > 1.8) showResult();
    }
    s.camX += (Math.max(0, Math.min(BEAM_LEN + 1.2, curX())) - s.camX) * Math.min(1, dt * 3);
  }

  function balance(dt, turning) {
    // 저절로 흔들리는 힘: 천천히 바뀌는 바람 + 걷는 흔들림
    s.gustT -= dt;
    if (s.gustT <= 0) { s.gustT = 0.4 + Math.random() * 0.8; s.gustTarget = (Math.random() * 2 - 1) * GUST; }
    s.gust += ((s.gustTarget || 0) - s.gust) * Math.min(1, dt * 3);
    var noise = s.gust * (turning ? 1.8 : 1) + (s.el ? 0 : Math.sin(s.t * 7) * 0.12);
    var ctrl = CTRL * input() * (turning ? 0.6 : 1);
    var a = A * Math.sin(s.phi) - ctrl - DAMP * s.w + noise;
    s.w += a * dt;
    s.phi += s.w * dt;
    var deg = Math.abs(s.phi) / DEG;
    if (deg > WOBBLE && !s.inWobble) { s.inWobble = true; s.wobbles++; SO.sound.beep(150, 0.06, 'square', 0.05); }
    if (deg < WOBBLE / 2) s.inWobble = false;
    if (deg > FALL) fall();
  }

  function updateElement(dt) {
    var el = s.el, e = ELEM[el.type];
    var dur = e.dur * (el.type === 'turn' ? el.turns : 1);
    el.t += dt;
    s.x = el.x0 + e.dx * Math.min(1, el.t / dur);
    if (el.t >= dur) {
      // 착지: 크게 휘청 (기울어진 채 뛰었으면 더 크게)
      var dir = Math.random() < 0.5 ? -1 : 1;
      s.w += dir * e.kick * (el.type === 'turn' ? el.turns : 1) + el.phi0 * 3;
      s.pending = { type: el.type, turns: el.turns, t: s.now };
      s.el = null;
      if (e.air) { SO.sound.noise(0.12, 0.25, 900); SO.vibrate(25); }
    }
  }

  function fall() {
    s.falls++;
    s.phase = 'fallen';
    s.fallT = 0;
    s.fallDir = s.phi >= 0 ? 1 : -1;
    s.el = null;
    s.pending = null;
    showBanner('떨어짐!', true);
    setTimeout(function () { if (ui.banner.textContent === '떨어짐!') hideBanner(); }, 1200);
    SO.sound.sweep(500, 120, 0.4, 'sawtooth', 0.12);
    SO.sound.noise(0.3, 0.3, 600);
    SO.vibrate([80, 40, 120]);
  }

  function startDismount(auto) {
    s.phase = 'dismount';
    s.dis = { t: 0, dur: auto ? 0.6 : 1.0, auto: auto, x0: s.x, phi0: s.phi, w0: s.w };
    s.pending = null;
    SO.sound.sweep(300, 800, 0.25, 'triangle', 0.12);
  }

  function landDismount() {
    var d = s.dis;
    s.endT = s.now;
    s.phase = 'landed';
    if (d.auto) { showBanner('착지', false); return; }
    // 뛸 때 균형이 좋을수록 착지가 깔끔
    var err = Math.abs(d.phi0) / DEG + Math.abs(d.w0) * 8 + Math.random() * 6;
    if (err > 35) {
      s.disFall = true;
      s.falls++;
      showBanner('넘어짐', true);
      SO.sound.noise(0.4, 0.3, 600);
      return;
    }
    var ded = err <= 8 ? 0 : err <= 15 ? 0.1 : err <= 25 ? 0.3 : 0.5;
    s.landDed = ded;
    s.stick = ded === 0;
    showBanner(ded === 0 ? '스틱!' : ded <= 0.1 ? '착지!' : '휘청', false);
    SO.sound.noise(1.6, ded === 0 ? 0.3 : 0.15, 2200);
    SO.vibrate(40);
  }

  function curX() {
    if (s.phase === 'dismount' || s.phase === 'landed') return s.dis.x0 + Math.min(1, s.dis.t / s.dis.dur) * (BEAM_LEN + 0.9 - s.dis.x0);
    return s.x;
  }
  function elemName(r) { return r.type === 'turn' && r.turns >= 2 ? '더블 턴' : ELEM[r.type].name; }

  // ---- 점수 ----
  function score() {
    var D = 0, count = {};
    s.done.forEach(function (r) {
      count[r.type] = (count[r.type] || 0) + 1;
      if (count[r.type] <= MAX_SAME) D += ELEM[r.type].d * (r.type === 'turn' ? r.turns : 1);
    });
    if (s.dis && !s.dis.auto && s.phase !== 'dismount') D += 0.6;
    var E = 10 - s.wobbles * 0.1 - s.falls * 1.0 - s.landDed - Math.max(0, REQ - s.done.length) * 1.0;
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

  function rankingRows(highlight, withMarks) {
    return ranking().map(function (r) {
      var b = best(r.p);
      var marks = r.p.routines.map(function (x) { return x.total.toFixed(2) + (x.falls ? '(낙하 ' + x.falls + ')' : ''); }).join(' · ');
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
    p.routines.push({ total: sc.total, D: sc.D, E: sc.E, falls: s.falls });

    ui.resScore.classList.toggle('foul', s.falls > 0);
    ui.resScore.textContent = sc.total.toFixed(2) + '점';
    ui.resBadge.classList.toggle('hidden', !(prevBest != null && sc.total > prevBest));
    var lines = [
      '난도 D ' + sc.D.toFixed(1) + ' · 실시 E ' + sc.E.toFixed(2),
      '성공한 기술 ' + s.done.length + '개' + (s.done.length ? ': ' + s.done.map(elemName).join(', ') : ''),
      '내리기: ' + (s.dis.auto ? (s.timeout ? '시간이 다 돼서 뛰어내림' : '그냥 뛰어내림') : s.disFall ? '공중돌기 · 넘어짐' : '공중돌기 · ' + (s.stick ? '스틱!' : '착지')),
    ];
    var ded = [];
    if (s.wobbles) ded.push('흔들림 ' + s.wobbles + '번 −' + (s.wobbles * 0.1).toFixed(1));
    if (s.falls) ded.push('떨어짐 ' + s.falls + '번 −' + s.falls.toFixed(1));
    if (s.done.length < REQ) ded.push('기술 부족 −' + (REQ - s.done.length));
    if (ded.length) lines.push('감점: ' + ded.join(' · '));
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
    SO.records.showNews(ui.final, 'beam', SO.records.save('beam', match.players.map(function (p) { return { name: p.name, value: best(p) }; }), ''));
    SO.olympic.onFinal('beam', ranking().map(function (r) {
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
    timingTimer = setTimeout(function () { ui.timing.classList.add('hidden'); }, 700);
  }

  var lastHud = '';
  function updateHud() {
    var deg = s.phi / DEG;
    var leanText = (deg > 1 ? '↗ ' : deg < -1 ? '↖ ' : '') + Math.round(Math.abs(deg));
    var skill = s.el ? elemName(s.el) : s.pending ? elemName(s.pending) + '…' : s.phase === 'end' ? '내리기' :
      s.phase === 'fallen' ? '떨어짐' : s.phase === 'dismount' ? '공중돌기' : s.phase === 'landed' ? '착지' : s.phase === 'intro' ? '준비' : '걷기';
    var sc = score();
    var scoreText = sc.D > 0 ? 'D ' + sc.D.toFixed(1) : '';
    var left = Math.ceil(TIME_LIMIT - s.t);
    var reqText = s.phase === 'intro' ? '' : '기술 ' + s.done.length + '/' + REQ + (left <= 15 && s.phase !== 'landed' ? ' · ⏱ ' + Math.max(0, left) + '초' : '');
    var u = input();
    var key = [leanText, skill, scoreText, reqText, s.phase, Math.round(u * 50), Math.round(deg)].join('|');
    if (key === lastHud) return;
    lastHud = key;
    ui.lean.textContent = leanText;
    ui.skill.textContent = skill;
    ui.scoreChip.textContent = scoreText;
    ui.reqChip.textContent = reqText;
    ui.reqChip.classList.toggle('ok', s.done.length >= REQ);
    ui.gestureHelp.classList.toggle('dismount', s.phase === 'end');
    // 바늘 = 몸 기울기 (FALL 이 끝), 손잡이 = 내 입력
    var pos = 50 + Math.max(-50, Math.min(50, deg / FALL * 50));
    ui.balNeedle.style.left = pos + '%';
    ui.balNeedle.classList.toggle('warn', Math.abs(deg) > WOBBLE);
    ui.balKnob.style.left = (50 + u * 42) + '%';
    ui.balKnob.classList.toggle('on', padId != null || (tiltOn && Math.abs(tiltU) > 0.05));
    ui.balText.textContent = Math.abs(deg) > WOBBLE ? (deg > 0 ? '앞으로 기울어요!' : '뒤로 기울어요!') : '균형';
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
    var top = W > H * 1.3 ? 80 : 130;
    PPM = Math.min(W / 3.6, (H - top - 40) / 3.4);
    GROUND = H - 40;
  }
  window.addEventListener('resize', resize);
  function sx(x) { return W / 2 + (x - s.camX) * PPM; }
  function sy(y) { return GROUND - y * PPM; }

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
      ctx.arc(cxp, sy(2.6) - (ci % 3) * 12 + Math.sin(time / 130 + ci) * 4 * cheer, Math.min(W / 70, 7), 0, TAU);
      ctx.fill();
    }
    // 바닥 + 매트
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, sy(0), W, H);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(sx(-1.5), sy(0.12), (BEAM_LEN + 4) * PPM, 0.12 * PPM + 2);
    // 평균대 다리 + 대
    ctx.fillStyle = '#64748b';
    [0.5, BEAM_LEN - 0.5].forEach(function (lx) {
      ctx.fillRect(sx(lx) - 4, sy(BEAM_H - 0.1), 8, (BEAM_H - 0.22) * PPM);
      ctx.fillRect(sx(lx) - 0.35 * PPM, sy(0.2), 0.7 * PPM, 0.08 * PPM + 2);
    });
    var beamG = ctx.createLinearGradient(0, sy(BEAM_H), 0, sy(BEAM_H - 0.1));
    beamG.addColorStop(0, '#f5e6c8');
    beamG.addColorStop(1, '#c8a97a');
    ctx.fillStyle = beamG;
    ctx.fillRect(sx(0), sy(BEAM_H), BEAM_LEN * PPM, 0.1 * PPM);
    // 끝 표시
    ctx.fillStyle = 'rgba(253,224,71,0.7)';
    ctx.fillRect(sx(END_X) - 1.5, sy(BEAM_H) - 6, 3, 6);

    drawGymnast(time);
  }

  var BAL_ARMS = [[1.75, 1.6], [-1.75, -1.6]];   // 팔 벌려 균형

  function drawGymnast(time) {
    var col = currentPlayer().color;
    var opt = { x: 0, y: 0, ppm: PPM, color: col };
    var feetX = s.x, feetY = BEAM_H, rot = s.phi, pose, spin = 1, hipRot = 0;
    if (s.phase === 'fallen') {
      // 평균대 옆으로 떨어져 바닥에 누움
      var f = Math.min(1, s.fallT / 0.5);
      feetY = BEAM_H * (1 - f * f) + 0.12 * f;
      rot = (s.phi >= 0 ? 1 : -1) * (Math.abs(s.phi) + (Math.PI / 2 - Math.abs(s.phi)) * f);
      pose = { hip: 0.95, lean: 0.2, legs: [[0.4, 0.3], [-0.3, -0.2]], arms: [[2.2, 2.0], [1.2, 1.0]] };
    } else if (s.phase === 'dismount' || s.phase === 'landed') {
      var d = s.dis, u = Math.min(1, d.t / d.dur);
      feetX = curX();
      feetY = s.phase === 'landed' ? 0.12 : BEAM_H * (1 - u) + 0.12 * u + (d.auto ? 0.4 : 1.1) * Math.sin(Math.PI * u);
      rot = 0;
      if (s.phase === 'landed') pose = s.disFall
        ? { hip: 0.5, lean: 0.9, legs: [[1.4, 0.4], [1.2, 0.3]], arms: [[1.2, 1.0], [0.6, 0.4]] }
        : { hip: 0.95, lean: -0.1, legs: [[0.15, 0.1], [-0.15, -0.1]], arms: [[2.7, 2.9], [-2.7, -2.9]] };
      else if (!d.auto) { pose = { hip: 0.95, lean: 0.45, legs: [[2.1, 0.5], [2.0, 0.4]], arms: [[1.6, 0.4], [1.5, 0.3]] }; hipRot = TAU * Math.min(1, u * 1.1); }
      else pose = { hip: 0.95, lean: 0, legs: [[0.3, 0.2], [-0.3, -0.2]], arms: [[2.6, 2.8], [-2.6, -2.8]] };
    } else if (s.el) {
      var el = s.el, e = ELEM[el.type];
      var p = Math.min(1, el.t / (e.dur * (el.type === 'turn' ? el.turns : 1)));
      if (el.type === 'jump') { feetY += 0.45 * Math.sin(Math.PI * p); pose = { hip: 0.95, lean: 0, legs: [[0.05, 0.05], [-0.05, -0.05]], arms: [[2.9, 3.0], [2.8, 2.9]] }; }
      else if (el.type === 'leap') { feetY += 0.4 * Math.sin(Math.PI * p); var sp = Math.sin(Math.PI * p); pose = { hip: 0.95, lean: 0.1, legs: [[1.5 * sp, 1.3 * sp], [-1.5 * sp, -1.4 * sp]], arms: [[2.2, 2.4], [-1.7, -1.6]] }; }
      else if (el.type === 'salto') { feetY += 0.55 * Math.sin(Math.PI * p); pose = { hip: 0.95, lean: 0.45, legs: [[2.1, 0.5], [2.0, 0.4]], arms: [[1.6, 0.4], [1.5, 0.3]] }; hipRot = -TAU * p; }
      else { pose = { hip: 1.0, lean: 0, legs: [[0.05, 0.05], [1.4, -0.4]], arms: [[3.0, 3.1], [2.9, 3.0]] }; spin = Math.cos(TAU * el.turns * p); }
    } else {
      // 걷기 / 버티기: 팔을 벌리고, 기울수록 팔을 휘저음
      var walkP = s.phase === 'walk' ? SO.athlete.runPose(s.x * 4, 0.25, 0, 1) : SO.athlete.standPose();
      var flail = Math.min(1, Math.abs(s.phi) / (FALL * DEG));
      pose = { hip: walkP.hip, lean: 0, legs: walkP.legs,
        arms: [[BAL_ARMS[0][0] + Math.sin(time / 70) * flail, BAL_ARMS[0][1]], [BAL_ARMS[1][0] - Math.sin(time / 70) * flail, BAL_ARMS[1][1]]] };
    }
    ctx.save();
    ctx.translate(sx(feetX), sy(feetY));
    ctx.rotate(rot);
    if (hipRot) {
      // 공중돌기: 엉덩이를 중심으로 회전
      ctx.translate(0, -pose.hip * PPM);
      ctx.rotate(hipRot);
      opt.toX = function (x) { return x * PPM; };
      opt.toY = function (y) { return -(y - pose.hip) * PPM; };
    } else {
      ctx.scale(spin === 1 ? 1 : (Math.abs(spin) < 0.15 ? 0.15 * Math.sign(spin || 1) : spin), 1);
      opt.toX = function (x) { return x * PPM; };
      opt.toY = function (y) { return -y * PPM; };
    }
    SO.athlete.draw(ctx, pose, opt);
    ctx.restore();
  }

  // ---- 메인 루프 ----
  var prev = 0;
  function frame(time) {
    var dt = Math.min(0.05, (time - prev) / 1000 || 0);
    prev = time;
    if (match && s && !ui.game.classList.contains('hidden')) {
      if (s.phase !== 'intro' && s.phase !== 'result') {
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
  window.Beam = {
    state: function () { return s; },
    match: function () { return match; },
    score: function () { return score(); },
    setInput: function (u) { padU = u; },
    gesture: function (g) { onGesture(g); },
    classify: classify,
  };

  SO.registerSW('../../sw.js');
  if (SO.olympic.active()) SO.olympic.start('beam', startMatch);
  else startSetup();
})();
