/*
 * 100m 달리기
 *
 * 1. "제자리에 → 차렷 → 탕!" 총소리 전에 누르면 부정 출발 (2번이면 실격)
 * 2. 달리기 버튼 연타 → 속도 상승. 탭마다 스태미너 소모, 시간이 지나면 회복
 *    → 세게 연타하면 줄고, 살살 달리면 다시 참. 바닥나면 지쳐서 다시 찰 때까지(약 2초) 느려짐
 * 3. 90m 지점(남은 10m)에서 스태미너가 꽉 참 → 마지막 스퍼트
 * 다른 선수들의 최고 기록은 유령 선수로 옆 레인에서 같이 달린다.
 */
(function () {
  'use strict';

  // ---- 튜닝 값 ----
  var FINISH = 100;
  var SPURT_AT = 90;        // 이 지점에서 스태미너 완충
  var V_MAX = 16;           // 이론상 최고 속도 (m/s) — 다가갈수록 탭 효과가 줄어든다
  var TAP_BOOST = 1.3;      // 한 번 탭할 때 속도 증가 (m/s)
  var DRAG = 0.32;          // 초당 감속 비율
  var TAP_COST = 3;         // 탭 한 번에 드는 스태미너
  var REGEN = 13;           // 초당 스태미너 회복 (≈ 초당 4.3번 연타까지는 줄지 않음)
  var LOW = 25;             // 이 아래로 내려가면 탭 효과가 서서히 줄어듦
  var TIRED_FACTOR = 0.2;   // 지쳤을 때 탭 효과 (스태미너는 안 듦)
  var TIRED_DRAG = 0.4;     // 지쳤을 때 추가 감속
  var RECOVER_AT = 30;      // 바닥난 뒤 이만큼 차야 회복
  var FALSE_START_MIN = 0.1;// 총소리 후 이보다 빨리 누르면 부정 출발 (실제 규칙)
  var TRACE_DT = 0.05;      // 유령 선수 기록 간격 (초)

  var SO = window.SO;
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    setup: $('setup'), game: $('game'), final: $('final'),
    hudDot: $('hudDot'), hudName: $('hudName'), hudAttempt: $('hudAttempt'), hudBest: $('hudBest'),
    stage: $('stage'), canvas: $('canvas'),
    speed: $('speed'), clock: $('clock'), toLine: $('toLine'), banner: $('banner'),
    stamina: $('stamina'), staminaFill: $('staminaFill'), staminaNote: $('staminaNote'),
    intro: $('intro'), introTurn: $('introTurn'), introName: $('introName'), introGo: $('introGo'),
    result: $('result'), resTime: $('resTime'), resBadge: $('resBadge'), resDetail: $('resDetail'),
    resTable: $('resTable'), resNext: $('resNext'),
    runBtn: $('runBtn'),
    finalTable: $('finalTable'), againBtn: $('againBtn'), setupBtn: $('setupBtn'),
  };
  var ctx = ui.canvas.getContext('2d');

  // ---- 경기 진행 상태 ----
  var match = null;   // { players: [{name,color,marks:[],bestTrace}], attempts, turn }
  var s = null;       // 현재 레이스 상태

  function currentPlayer() { return match.players[match.turn % match.players.length]; }
  function currentRound() { return Math.floor(match.turn / match.players.length) + 1; }
  function totalTurns() { return match.players.length * match.attempts; }

  function newRace() {
    s = {
      phase: 'intro',     // intro → marks → set → run → finished | dq → result
      t: 0,               // 현재 단계 경과 시간
      setDelay: 0,
      x: 0, v: 0, topV: 0,
      raceT: 0,           // 총소리부터 경과 시간
      stamina: 100, tired: false, spurt: false,
      staminaTrend: 0,
      reaction: null,
      falseStarts: 0,
      time: null,         // 결승선 통과 기록
      trace: [0],
      cam: -3,
    };
  }

  // ---- 화면 전환 ----
  function show(el) {
    [ui.setup, ui.game, ui.final].forEach(function (x) { x.classList.toggle('hidden', x !== el); });
  }

  function startSetup() {
    show(ui.setup);
    SO.setupPlayers(ui.setup, {
      title: '⏱️ 100m 달리기',
      storageKey: 'sprint100',
      maxPlayers: 8,
      attemptChoices: [1, 2, 3],
      defaultAttempts: 1,
      backHref: '../../',
    }, function (cfg) {
      SO.enterGameMode();
      startMatch(cfg.players, cfg.attempts);
    });
  }

  function startMatch(players, attempts) {
    match = {
      // 다시 하기 때는 지난 경기 최고 기록이 유령 선수로 남는다
      players: players.map(function (p) { return { name: p.name, color: p.color, marks: [], bestTrace: p.bestTrace || null, bestTime: p.bestTime || null }; }),
      attempts: attempts,
      turn: 0,
    };
    show(ui.game);
    resize();
    beginTurn();
  }

  function beginTurn() {
    newRace();
    var p = currentPlayer();
    ui.hudDot.style.background = p.color;
    ui.hudName.textContent = p.name;
    ui.hudAttempt.textContent = match.attempts > 1 ? currentRound() + '/' + match.attempts + '차 레이스' : '';
    var b = best(p);
    ui.hudBest.textContent = b == null ? '' : '최고 ' + fmtTime(b);
    ui.introTurn.textContent = (match.attempts > 1 ? currentRound() + '차 레이스' : '레이스') +
      (match.players.length > 1 ? ' · ' + (match.turn % match.players.length + 1) + '번째 선수' : '');
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
    startSequence();
  });

  function startSequence() {
    s.phase = 'marks';
    s.t = 0;
    s.x = 0; s.v = 0; s.raceT = 0; s.trace = [0];
    s.reaction = null; s.topV = 0;
    s.stamina = 100; s.tired = false; s.spurt = false;
    ui.toLine.textContent = s.falseStarts ? '한 번 더 부정 출발하면 실격!' : '';
    lastHud = '';
    showBanner('제자리에', false);
    SO.sound.beep(440, 0.15, 'sine', 0.15);
  }

  // ---- 입력 ----
  function tap() {
    if (s.phase === 'marks' || s.phase === 'set') return falseStart();
    if (s.phase !== 'run') return;
    if (s.reaction == null) {
      s.reaction = s.raceT;
      if (s.reaction < FALSE_START_MIN) return falseStart();
    }
    var f = s.tired ? TIRED_FACTOR : s.stamina < LOW ? 0.55 + 0.45 * s.stamina / LOW : 1;
    s.v += TAP_BOOST * f * Math.max(0, 1 - s.v / V_MAX);
    if (!s.tired) s.stamina = Math.max(0, s.stamina - TAP_COST);
    if (s.stamina === 0 && !s.tired) {
      s.tired = true;
      SO.vibrate([60, 40, 60]);
      SO.sound.sweep(400, 150, 0.4, 'sawtooth', 0.12);
    }
    SO.sound.beep(160 + s.v * 14, 0.035, 'square', s.tired ? 0.03 : 0.05);
    SO.vibrate(8);
  }

  function falseStart() {
    s.falseStarts++;
    SO.sound.beep(140, 0.6, 'sawtooth', 0.22);
    SO.vibrate([80, 40, 80]);
    if (s.falseStarts >= 2) {
      s.phase = 'dq';
      s.t = 0;
      showBanner('실격', true);
    } else {
      s.phase = 'falsestart';
      s.t = 0;
      showBanner('부정 출발!', true);
    }
  }

  function pressFx(btn) {
    btn.classList.add('pressed');
    clearTimeout(btn._t);
    btn._t = setTimeout(function () { btn.classList.remove('pressed'); }, 70);
  }

  ui.runBtn.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    pressFx(ui.runBtn);
    tap();
  });
  document.addEventListener('contextmenu', function (e) { if (!ui.game.classList.contains('hidden')) e.preventDefault(); });

  // 키보드 (PC 테스트용): 스페이스/→ = 달리기
  document.addEventListener('keydown', function (e) {
    if (!match || ui.game.classList.contains('hidden')) return;
    if ((e.code === 'Space' || e.code === 'ArrowRight') && !e.repeat) { e.preventDefault(); tap(); }
  });

  // ---- 진행 ----
  function update(dt) {
    s.t += dt;
    var prevStamina = s.stamina;

    switch (s.phase) {
      case 'marks':
        if (s.t > 1.2) {
          s.phase = 'set';
          s.t = 0;
          s.setDelay = 1 + Math.random() * 1.6; // 총소리 타이밍을 예측할 수 없게
          showBanner('차렷', false);
          SO.sound.beep(520, 0.15, 'sine', 0.15);
        }
        break;
      case 'set':
        if (s.t > s.setDelay) {
          s.phase = 'run';
          s.t = 0;
          s.raceT = 0;
          showBanner('탕!', false);
          SO.sound.noise(0.25, 0.7, 5000);
          SO.sound.beep(980, 0.08, 'square', 0.2);
        }
        break;
      case 'falsestart':
        if (s.t > 1.6) {
          startSequence();
        }
        break;
      case 'run':
      case 'finished': {
        if (s.phase === 'run' && s.t > 0.6 && ui.banner.textContent === '탕!') hideBanner();
        s.raceT += dt;
        s.stamina = Math.min(100, s.stamina + REGEN * dt);
        if (s.tired && s.stamina >= RECOVER_AT) s.tired = false;
        var prevX = s.x;
        if (s.phase === 'finished') s.v = Math.max(0, s.v - 5 * dt);
        else s.v = Math.max(0, s.v - (DRAG + (s.tired ? TIRED_DRAG : 0)) * s.v * dt);
        s.x += s.v * dt;
        s.topV = Math.max(s.topV, s.v);
        recordTrace();

        if (!s.spurt && s.x >= SPURT_AT) {
          s.spurt = true;
          s.stamina = 100;
          s.tired = false;
          showBanner('라스트 스퍼트!', false);
          SO.sound.sweep(400, 1200, 0.4, 'triangle', 0.2);
          SO.vibrate(40);
        }
        if (s.phase === 'run' && s.x >= FINISH) {
          // 프레임 사이에서 정확히 결승선을 지난 시각 계산
          var frac = (FINISH - prevX) / Math.max(1e-6, s.x - prevX);
          s.time = Math.floor((s.raceT - dt + dt * frac) * 100 + 1e-6) / 100;
          s.phase = 'finished';
          s.t = 0;
          showBanner(fmtTime(s.time), false);
          SO.sound.noise(1.8, 0.3, 2200);
          SO.vibrate([30, 30, 30]);
        }
        if (s.phase === 'finished' && s.t > 1.8) showResult();
        if (s.phase === 'run' && s.raceT > 60) { s.phase = 'dq'; s.t = 0; showBanner('기권', true); }
        break;
      }
      case 'dq':
        if (s.t > 1.6) showResult();
        break;
    }
    var d = (s.stamina - prevStamina) / Math.max(dt, 1e-3);
    s.staminaTrend += (d - s.staminaTrend) * Math.min(1, dt * 4);

    var view = W / PPM;
    s.cam += (s.x - view * 0.32 - s.cam) * Math.min(1, dt * 6);
  }

  function recordTrace() {
    var n = Math.floor(s.raceT / TRACE_DT);
    while (s.trace.length <= n && s.trace.length < 2000) s.trace.push(s.x);
  }

  function ghostX(trace, t) {
    var i = t / TRACE_DT;
    var a = Math.floor(i);
    if (a >= trace.length - 1) return trace[trace.length - 1];
    return trace[a] + (trace[a + 1] - trace[a]) * (i - a);
  }

  // ---- 결과 / 순위 ----
  function best(p) {
    var b = null;
    p.marks.forEach(function (m) { if (m.time != null && (b == null || m.time < b)) b = m.time; });
    return b;
  }
  function sortedTimes(p) {
    return p.marks.map(function (m) { return m.time == null ? Infinity : m.time; }).sort(function (a, b) { return a - b; });
  }
  // 최고 기록 → 두 번째 기록 → … 순으로 비교
  function compare(a, b) {
    var ta = sortedTimes(a), tb = sortedTimes(b);
    for (var i = 0; i < Math.max(ta.length, tb.length); i++) {
      var x = ta[i] == null ? Infinity : ta[i], y = tb[i] == null ? Infinity : tb[i];
      if (x !== y) return x === Infinity ? 1 : y === Infinity ? -1 : x - y;
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
  function fmtTime(t) { return t.toFixed(2) + '초'; }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function rankingRows(highlight, withMarks) {
    return ranking().map(function (r) {
      var b = best(r.p);
      var marks = r.p.marks.map(function (m) { return m.time == null ? '실격' : m.time.toFixed(2); }).join(' · ');
      return '<tr class="' + (r.p === highlight ? 'me' : '') + '">' +
        '<td class="rank">' + (b == null ? '-' : medal(r.rank)) + '</td>' +
        '<td><span style="color:' + r.p.color + '">●</span> ' + esc(r.p.name) +
        (withMarks && match.attempts > 1 && marks ? '<div class="marks">' + marks + '</div>' : '') + '</td>' +
        '<td class="num">' + (b == null ? (r.p.marks.length ? '기록 없음' : '-') : fmtTime(b)) + '</td></tr>';
    }).join('');
  }

  function showResult() {
    if (s.phase === 'result') return;
    var wasDq = s.phase === 'dq';
    s.phase = 'result';
    hideBanner();
    var p = currentPlayer();
    var prevBest = best(p);
    var time = wasDq ? null : s.time;
    p.marks.push({ time: time });
    if (time != null && (p.bestTime == null || time < p.bestTime)) { p.bestTime = time; p.bestTrace = s.trace.slice(); }

    ui.resTime.classList.toggle('foul', time == null);
    ui.resTime.textContent = time == null ? (s.falseStarts >= 2 ? '실격 ✕' : '기권') : fmtTime(time);
    ui.resBadge.textContent = time != null && time < 10 ? '🔥 9초대! 개인 최고!' : '개인 최고!';
    ui.resBadge.classList.toggle('hidden', !(time != null && prevBest != null && time < prevBest));
    ui.resDetail.textContent = time == null
      ? (s.falseStarts >= 2 ? '부정 출발 2회' : '')
      : '반응 ' + s.reaction.toFixed(2) + '초 · 최고 시속 ' + (s.topV * 3.6).toFixed(1) + ' km/h';
    ui.resTable.innerHTML = match.players.length > 1 ? rankingRows(p, false) : '';

    var last = match.turn + 1 >= totalTurns();
    if (last) ui.resNext.textContent = '최종 결과 보기';
    else {
      var np = match.players[(match.turn + 1) % match.players.length];
      ui.resNext.textContent = match.players.length > 1 ? '다음: ' + np.name : '다음 레이스';
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
    var running = s.phase === 'run' || s.phase === 'finished' || s.phase === 'result';
    var clock = s.time != null ? s.time : running ? s.raceT : 0;
    var st = Math.round(s.stamina);
    var note = s.spurt ? '라스트 스퍼트! ' + st + '%'
      : s.tired ? '지쳤어요! 살살 달려서 회복'
      : (s.phase === 'run' && s.staminaTrend > 2 ? '▲ 회복 중 ' : s.phase === 'run' && s.staminaTrend < -2 ? '▼ ' : '') + st + '%';
    var remain = FINISH - s.x;
    var lineText = s.phase === 'run'
      ? (remain <= FINISH - SPURT_AT ? '결승까지 ' : s.x >= SPURT_AT - 10 ? '스퍼트 구간까지 ' + (SPURT_AT - s.x).toFixed(1) + ' m · ' : '남은 거리 ') + remain.toFixed(1) + ' m'
      : null;
    var key = [s.phase, s.v.toFixed(1), clock.toFixed(2), st, note, lineText, s.tired, s.spurt].join('|');
    if (key === lastHud) return;
    lastHud = key;
    ui.speed.textContent = (s.v * 3.6).toFixed(1);
    ui.clock.textContent = clock.toFixed(2);
    ui.staminaFill.style.width = s.stamina + '%';
    ui.staminaNote.textContent = note;
    ui.stamina.classList.toggle('spurt', s.spurt);
    ui.stamina.classList.toggle('empty', s.tired && !s.spurt);
    ui.stamina.classList.toggle('low', !s.spurt && s.stamina < LOW);
    ui.stamina.classList.toggle('mid', !s.spurt && s.stamina >= LOW && s.stamina < 50);
    ui.runBtn.classList.toggle('tired', s.tired);
    if (lineText != null) ui.toLine.textContent = lineText;
    ui.toLine.classList.toggle('hidden', !(lineText != null || s.phase === 'marks' || s.phase === 'set') || !ui.toLine.textContent);
    ui.toLine.classList.toggle('zone', s.spurt && s.phase === 'run');
  }

  // ---- 그리기 ----
  var W = 0, H = 0, DPR = 1, PPM = 30;
  function resize() {
    var r = ui.stage.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    ui.canvas.width = Math.round(W * DPR);
    ui.canvas.height = Math.round(H * DPR);
    PPM = Math.min(W / 8.5, H / 5.5);
  }
  window.addEventListener('resize', resize);

  function sx(x) { return (x - s.cam) * PPM; }

  // 레인 배치: 지금 달리는 선수가 맨 앞(아래) 레인, 나머지는 뒤쪽
  function lanes() {
    var cur = currentPlayer();
    return [cur].concat(match.players.filter(function (p) { return p !== cur; }));
  }

  function draw(time) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var order = lanes();
    var n = order.length;
    var trackH = Math.min(H * 0.45, Math.max(PPM * 1.2, n * PPM * 0.6));
    var base = H - trackH;
    var laneH = trackH / n;

    SO.stadium.draw(ctx, {
      width: W, base: base, ppm: PPM, cam: s.cam, time: time,
      cheer: s.phase === 'finished' || s.phase === 'result' ? 1 : s.x > 70 && s.phase === 'run' ? 0.6 : 0.25,
    });

    // 트랙
    ctx.fillStyle = '#c2410c';
    ctx.fillRect(0, base, W, trackH);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (var i = 0; i <= n; i++) ctx.fillRect(0, base + laneH * i - (i === n ? 2 : 0), W, 2);
    // 10m마다 눈금
    ctx.font = '700 ' + Math.round(Math.min(PPM * 0.38, laneH * 0.6 + 6)) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var m = 10; m < FINISH; m += 10) {
      var mx = sx(m);
      if (mx < -40 || mx > W + 40) continue;
      ctx.fillStyle = m === SPURT_AT ? '#fde047' : 'rgba(255,255,255,0.55)';
      ctx.fillRect(mx - 1, base, m === SPURT_AT ? 3 : 2, trackH);
      ctx.fillText(m + 'm', mx + PPM * 0.5, base + 12);
    }
    // 출발선
    ctx.fillStyle = '#fff';
    ctx.fillRect(sx(0) - 2, base, 4, trackH);
    // 결승선 (체크무늬)
    var fx = sx(FINISH);
    if (fx > -20 && fx < W + 20) {
      var sq = Math.max(4, laneH / 4);
      for (var yy = 0; yy * sq < trackH; yy++) {
        for (var xx = 0; xx < 2; xx++) {
          ctx.fillStyle = (xx + yy) % 2 ? '#111' : '#fff';
          ctx.fillRect(fx + xx * sq - sq, base + yy * sq, sq, Math.min(sq, trackH - yy * sq));
        }
      }
      ctx.fillStyle = '#e5e7eb';
      ctx.fillRect(fx - 3, base - PPM * 2.4, 6, PPM * 2.4);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(fx - PPM * 0.9, base - PPM * 2.6, PPM * 1.8, PPM * 0.5);
      ctx.fillStyle = '#fff';
      ctx.font = '800 ' + Math.round(PPM * 0.34) + 'px system-ui, sans-serif';
      ctx.fillText('FINISH', fx, base - PPM * 2.35);
    }

    // 선수들 (뒤 레인부터)
    var raceT = s.phase === 'run' || s.phase === 'finished' || s.phase === 'result' ? s.raceT : 0;
    for (var li = n - 1; li >= 0; li--) {
      var p = order[li];
      var footY = H - laneH * (li + 0.5);
      var toY = (function (fy) { return function (y) { return fy - y * PPM; }; })(footY);
      var isMe = li === 0;
      var x, v, alpha;
      if (isMe) {
        x = s.x; v = s.v; alpha = 1;
      } else {
        if (!p.bestTrace) continue;
        x = ghostX(p.bestTrace, raceT);
        v = (ghostX(p.bestTrace, raceT + 0.1) - x) / 0.1;
        alpha = 0.45;
      }
      // 그림자
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.ellipse(sx(x), footY, PPM * 0.35, Math.max(2, PPM * 0.08), 0, 0, 6.283);
      ctx.fill();
      var pose = v > 0.05 || (isMe && s.phase === 'run')
        ? SO.athlete.runPose(x, Math.min(1, v / 6), isMe && s.tired ? -0.2 : 0)
        : (raceT === 0 && (s.phase === 'set' || s.phase === 'marks') ? crouchPose(s.phase === 'set') : SO.athlete.standPose());
      SO.athlete.draw(ctx, pose, { x: x, y: 0, toX: sx, toY: toY, ppm: PPM, color: p.color, alpha: alpha });
      if (!isMe) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 0.8;
        ctx.font = '700 ' + Math.round(PPM * 0.3) + 'px system-ui, sans-serif';
        ctx.fillText(p.name, sx(x), toY(2.05));
        ctx.globalAlpha = 1;
      }
      // 지쳤을 때 땀방울
      if (isMe && s.tired && s.phase === 'run') {
        ctx.fillStyle = '#7dd3fc';
        for (var k = 0; k < 3; k++) {
          var ph = ((time / 400) + k / 3) % 1;
          ctx.beginPath();
          ctx.arc(sx(x) - PPM * (0.15 + ph * 0.4), toY(1.75 - ph * 0.5), PPM * 0.05, 0, 6.283);
          ctx.fill();
        }
      }
    }

    // 속도선
    if (s.phase === 'run' && s.v > 7) {
      ctx.strokeStyle = 'rgba(255,255,255,' + Math.min(0.6, (s.v - 7) / 6) + ')';
      ctx.lineWidth = 2;
      var fy0 = H - laneH * 0.5;
      for (var q = 0; q < 4; q++) {
        var ly = fy0 - (0.4 + q * 0.35) * PPM;
        var lx = sx(s.x) - PPM * (0.6 + ((time / 40 + q * 7) % 10) / 10);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx - PPM * 0.8, ly);
        ctx.stroke();
      }
    }
  }

  // 출발 자세: '제자리에'는 낮게 웅크리고, '차렷'은 엉덩이를 든다
  function crouchPose(set) {
    return set
      ? { hip: 0.62, lean: 1.25, legs: [[1.3, -0.3], [0.2, -0.9]], arms: [[0.15, 0.05], [0.0, 0.0]] }
      : { hip: 0.45, lean: 1.0, legs: [[1.6, 0.0], [0.6, -1.2]], arms: [[0.25, 0.1], [0.1, 0.05]] };
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
  window.Sprint = {
    state: function () { return s; },
    match: function () { return match; },
  };

  SO.registerSW('../../sw.js');
  startSetup();
})();
