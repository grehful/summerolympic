/*
 * 손가락 '휙' 튕기기 측정. 던지는 종목들이 같이 쓴다.
 *
 *   var path = [];
 *   SO.flick.add(path, e.clientX, e.clientY, e.timeStamp);   // pointerdown / pointermove 마다
 *   var f = SO.flick.measure(path, 100);                      // 손을 뗄 때
 *   f.speed  → 마지막 100ms 동안의 속도 (px/s)
 *   f.angle  → 그 방향 (도). 오른쪽 = 0, 위 = 90, 왼쪽 = 180, 아래 = -90
 */
(function () {
  var SO = (window.SO = window.SO || {});

  SO.flick = {
    add: function (path, x, y, t) {
      path.push({ x: x, y: y, t: t });
      if (path.length > 60) path.shift();
    },
    measure: function (path, windowMs) {
      if (!path.length) return { speed: 0, angle: 0 };
      var last = path[path.length - 1];
      var first = last;
      for (var i = path.length - 1; i >= 0; i--) {
        first = path[i];
        if (last.t - path[i].t >= windowMs) break;
      }
      var dt = Math.max(0.016, (last.t - first.t) / 1000);
      var dx = last.x - first.x, dy = last.y - first.y;
      return { speed: Math.hypot(dx, dy) / dt, angle: Math.atan2(-dy, dx) * 180 / Math.PI };
    },
  };
})();
