/*
 * 종목 목록. 새 종목을 만들면 games/<폴더>/index.html 을 만들고 여기에 한 줄 추가.
 * ready: false 인 종목은 메인 화면에 '준비 중'으로 표시된다.
 */
window.SO = window.SO || {};
window.SO.GAMES = [
  { id: 'long-jump', name: '멀리뛰기', icon: '🏃', desc: '연타로 달리고, 각도를 맞춰 점프!', ready: true },
  { id: 'sprint-100m', name: '100m 달리기', icon: '⏱️', desc: '스태미너를 아끼다가 마지막 10m 스퍼트!', ready: true },
  { id: 'javelin', name: '창던지기', icon: '🎯', desc: '준비 중', ready: false },
  { id: 'high-jump', name: '높이뛰기', icon: '🤸', desc: '준비 중', ready: false },
  { id: 'weightlifting', name: '역도', icon: '🏋️', desc: '준비 중', ready: false },
  { id: 'archery', name: '양궁', icon: '🏹', desc: '바람을 읽고, 흔들림이 멎는 순간 발사!', ready: true },
];
