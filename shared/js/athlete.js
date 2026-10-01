/*
 * 막대 인형 선수 그리기. 육상 종목들이 같이 쓴다.
 *
 * 자세(pose) = { hip: 엉덩이 높이(m), lean: 상체 기울기(rad, 앞으로 +),
 *               legs: [[허벅지, 정강이] 앞다리, 뒷다리], arms: [[윗팔, 아래팔] 앞팔, 뒷팔] }
 * 팔다리 각도는 '아래 방향 = 0', 앞쪽(+x)으로 돌수록 + (π = 위로 쭉)
 *
 *   SO.athlete.draw(ctx, pose, { x, y, toX, toY, ppm, color, alpha })
 *     x, y: 선수 발 기준 위치(m), toX/toY: m → 화면 px 변환 함수
 */
(function () {
  var SO = (window.SO = window.SO || {});

  SO.athlete = {
    standPose: function () {
      return { hip: 0.95, lean: 0, legs: [[0.05, 0.05], [-0.05, -0.05]], arms: [[0.15, 0.3], [-0.1, 0.05]] };
    },

    // stride: 지금까지 달린 거리(m), amp: 동작 크기 0~1, lean: 추가 기울기
    runPose: function (stride, amp, lean, strideLen) {
      var p = stride / (strideLen || 2.2) * Math.PI * 2;
      var leg = function (ph) {
        var th = Math.sin(ph) * 0.85 * amp;
        var knee = (0.25 + 1.2 * Math.max(0, Math.cos(ph))) * amp;
        return [th, th - knee];
      };
      var arm = function (ph) {
        var up = -Math.sin(ph) * 0.9 * amp;
        return [up, up + 1.4 * amp + 0.1];
      };
      return {
        hip: 0.95 - Math.abs(Math.cos(p)) * 0.04 * amp,
        lean: 0.05 + 0.2 * amp + (lean || 0),
        legs: [leg(p), leg(p + Math.PI)],
        arms: [arm(p + Math.PI), arm(p)],
      };
    },

    draw: function (ctx, pose, o) {
      var sx = o.toX, sy = o.toY, ppm = o.ppm;
      var hx = o.x, hy = o.y + pose.hip;
      var seg = function (x, y, a, len) { return [x + Math.sin(a) * len, y - Math.cos(a) * len]; };
      var line = function (pts, w, col) {
        ctx.strokeStyle = col;
        ctx.lineWidth = w * ppm;
        ctx.beginPath();
        ctx.moveTo(sx(pts[0][0]), sy(pts[0][1]));
        for (var i = 1; i < pts.length; i++) ctx.lineTo(sx(pts[i][0]), sy(pts[i][1]));
        ctx.stroke();
      };
      var limb = function (origin, angles, l1, l2, col, w) {
        var j = seg(origin[0], origin[1], angles[0], l1);
        var e = seg(j[0], j[1], angles[1], l2);
        line([origin, j, e], w, col);
      };

      ctx.save();
      ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      var sh = [hx + Math.sin(pose.lean) * 0.5, hy + Math.cos(pose.lean) * 0.5];
      var head = [hx + Math.sin(pose.lean) * 0.7, hy + Math.cos(pose.lean) * 0.7];

      // 뒤쪽 팔다리 (어둡게)
      limb([hx, hy], pose.legs[1], 0.46, 0.46, '#b07d5a', 0.11);
      limb(sh, pose.arms[1], 0.3, 0.28, '#b07d5a', 0.08);
      // 몸통 (유니폼)
      line([[hx, hy], sh], 0.2, o.color);
      // 반바지
      ctx.fillStyle = '#1f2937';
      ctx.beginPath();
      ctx.arc(sx(hx), sy(hy), 0.12 * ppm, 0, 6.283);
      ctx.fill();
      // 앞쪽 팔다리
      limb([hx, hy], pose.legs[0], 0.46, 0.46, '#e6b38c', 0.12);
      limb(sh, pose.arms[0], 0.3, 0.28, '#e6b38c', 0.085);
      // 머리
      ctx.fillStyle = '#e6b38c';
      ctx.beginPath();
      ctx.arc(sx(head[0]), sy(head[1]), 0.13 * ppm, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = '#1f2937';
      ctx.beginPath();
      ctx.arc(sx(head[0]) - 0.03 * ppm, sy(head[1]) - 0.03 * ppm, 0.13 * ppm, Math.PI * 0.9, Math.PI * 2.05);
      ctx.fill();
      ctx.restore();
    },
  };
})();
