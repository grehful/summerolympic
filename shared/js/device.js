/*
 * 폰에서 게임할 때 필요한 공통 기능: 효과음, 진동, 화면 꺼짐 방지, 전체화면.
 * 모든 기능은 지원하지 않는 기기에서 조용히 무시된다.
 */
(function () {
  var SO = (window.SO = window.SO || {});
  var ctx = null;

  function audio() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  SO.sound = {
    muted: false,
    // 짧은 음: freq(Hz), dur(초), type, volume
    beep: function (freq, dur, type, vol) {
      var a = !this.muted && audio();
      if (!a) return;
      var t = a.currentTime;
      var o = a.createOscillator();
      var g = a.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol == null ? 0.15 : vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    },
    // 음 높이가 미끄러지는 소리 (점프 등)
    sweep: function (from, to, dur, type, vol) {
      var a = !this.muted && audio();
      if (!a) return;
      var t = a.currentTime;
      var o = a.createOscillator();
      var g = a.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(vol == null ? 0.2 : vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    },
    // 잡음 (모래 착지, 관중 함성)
    noise: function (dur, vol, lowpass) {
      var a = !this.muted && audio();
      if (!a) return;
      var len = Math.floor(a.sampleRate * dur);
      var buf = a.createBuffer(1, len, a.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = a.createBufferSource();
      src.buffer = buf;
      var f = a.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass || 1200;
      var g = a.createGain();
      g.gain.value = vol == null ? 0.3 : vol;
      src.connect(f).connect(g).connect(a.destination);
      src.start();
    },
    unlock: function () { audio(); },
  };

  SO.vibrate = function (pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* 무시 */ }
  };

  var wakeLock = null;
  SO.keepAwake = function () {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        navigator.wakeLock.request('screen').then(function (l) {
          wakeLock = l;
          l.addEventListener('release', function () { wakeLock = null; });
        }).catch(function () {});
      }
    } catch (e) { /* 무시 */ }
  };
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && SO._wantAwake) SO.keepAwake();
  });

  SO.enterGameMode = function () {
    SO._wantAwake = true;
    SO.keepAwake();
    SO.sound.unlock();
    var el = document.documentElement;
    if (SO.isApp) return; // 앱은 이미 전체화면
    try {
      if (!document.fullscreenElement && el.requestFullscreen) {
        el.requestFullscreen({ navigationUI: 'hide' }).catch(function () {});
      }
    } catch (e) { /* 무시 */ }
  };

  // 안드로이드 앱(APK) 안에서 실행 중인지
  SO.isApp = location.hostname === 'appassets.androidplatform.net';

  // 오프라인 실행 / 홈 화면 설치용 서비스 워커 (사이트 루트 기준 경로를 넘겨준다). 앱에서는 필요 없음
  SO.registerSW = function (path) {
    if (!SO.isApp && 'serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register(path).catch(function () {});
    }
  };
})();
