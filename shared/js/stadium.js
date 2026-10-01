/*
 * 경기장 배경 (하늘 + 관중석 + 광고판). 육상 종목들이 같이 쓴다.
 *
 *   SO.stadium.draw(ctx, {
 *     width, base,      // 화면 너비(px), 광고판 아래쪽 끝 y(px) = 트랙이 시작되는 곳
 *     ppm, cam,         // 1m당 픽셀, 카메라 왼쪽 끝 위치(m)
 *     time, cheer,      // ms 타임스탬프, 관중 들썩임 0~1
 *   });
 */
(function () {
  var SO = (window.SO = window.SO || {});

  var CROWD_LEN = 24; // 이 길이(m)마다 관중 무늬 반복
  var ROWS = 7;
  var crowd = [];
  var colors = ['#ef4444', '#3b82f6', '#facc15', '#22c55e', '#f8fafc', '#a855f7', '#fb923c', '#0ea5e9', '#f472b6'];
  for (var row = 0; row < ROWS; row++) {
    for (var x = 0; x < CROWD_LEN; x += 0.55) {
      if (Math.random() < 0.12) continue;
      crowd.push({ x: x + Math.random() * 0.2, row: row, c: colors[(Math.random() * colors.length) | 0], b: Math.random() * 6.28 });
    }
  }

  SO.stadium = {
    draw: function (ctx, o) {
      var W = o.width, base = o.base, ppm = o.ppm, cam = o.cam;
      var viewM = W / ppm;

      // 하늘
      var sky = ctx.createLinearGradient(0, 0, 0, base);
      sky.addColorStop(0, '#5aa9e6');
      sky.addColorStop(1, '#bfe3ff');
      ctx.fillStyle = sky;
      ctx.fillRect(0, -10, W, base + 10);

      // 관중석 (원근감을 위해 카메라보다 천천히 움직임)
      var standTop = base - ppm * 3.4;
      var standBottom = base - ppm * 0.9;
      ctx.fillStyle = '#334155';
      ctx.fillRect(0, standTop, W, standBottom - standTop);
      var rowH = (standBottom - standTop) / ROWS;
      var offset = cam * 0.5;
      var startRep = Math.floor(offset / CROWD_LEN) - 1;
      var cheer = o.cheer == null ? 0.25 : o.cheer;
      for (var rep = startRep; rep <= startRep + Math.ceil(viewM / CROWD_LEN) + 2; rep++) {
        for (var i = 0; i < crowd.length; i++) {
          var c = crowd[i];
          var px = (rep * CROWD_LEN + c.x - offset) * ppm;
          if (px < -10 || px > W + 10) continue;
          var bob = Math.sin(o.time / 120 + c.b) * cheer * rowH * 0.18;
          ctx.fillStyle = c.c;
          ctx.beginPath();
          ctx.arc(px, standTop + rowH * (c.row + 0.55) + bob, rowH * 0.32, 0, 6.283);
          ctx.fill();
        }
      }

      // 광고판
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(0, standBottom, W, base - standBottom);
      ctx.fillStyle = '#fbbf24';
      ctx.font = '700 ' + Math.round((base - standBottom) * 0.5) + 'px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      for (var ax = Math.floor(cam / 8) * 8; ax < cam + viewM + 8; ax += 8) {
        ctx.fillText('SUMMER OLYMPIC', (ax - cam) * ppm, (standBottom + base) / 2);
      }
    },
  };
})();
