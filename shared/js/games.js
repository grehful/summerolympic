/*
 * 종목 목록. 새 종목을 만들면 games/<폴더>/index.html 을 만들고 여기에 한 줄 추가.
 * ready: false 인 종목은 메인 화면에 '준비 중'으로 표시된다.
 */
window.SO = window.SO || {};
window.SO.GAMES = [
  { id: 'long-jump', name: '멀리뛰기', icon: '🏃', desc: '연타로 달리고, 각도를 맞춰 점프!', ready: true },
  { id: 'triple-jump', name: '3단 뛰기', icon: '🦘', desc: '홉·스텝·점프, 착지 리듬을 맞춰라!', ready: true },
  { id: 'sprint-100m', name: '100m 달리기', icon: '⏱️', desc: '스태미너를 아끼다가 마지막 10m 스퍼트!', ready: true },
  { id: 'shot-put', name: '투포환', icon: '💪', desc: '빙글빙글 돌리다가 휙! 던지기', ready: true },
  { id: 'javelin', name: '창던지기', icon: '🎯', desc: '번갈아 달리다가 화면을 휙! 선은 밟지 말기', ready: true },
  { id: 'high-jump', name: '높이뛰기', icon: '🤸', desc: '준비 중', ready: false },
  { id: 'weightlifting', name: '역도', icon: '🏋️', desc: '준비 중', ready: false },
  { id: 'archery', name: '양궁', icon: '🏹', desc: '바람을 읽고, 흔들림이 멎는 순간 발사!', ready: true },
];
