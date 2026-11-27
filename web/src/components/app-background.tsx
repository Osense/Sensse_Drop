/**
 * 화면 전체 뒷배경 (WSNS 디지털 느낌): 천천히 흐르는 브랜드 그라데이션 빛 + 격자 + 위아래로 지나가는 스캔 빛.
 * 움직임 줄이기 설정을 켠 기기에서는 멈춰 있어요. (globals.css .app-bg)
 */
export function AppBackground() {
  return (
    <div className="app-bg" aria-hidden>
      <div className="app-bg-wash" />
      <div className="app-bg-blob app-bg-blob-1" />
      <div className="app-bg-blob app-bg-blob-2" />
      <div className="app-bg-blob app-bg-blob-3" />
      <div className="app-bg-grid" />
      <div className="app-bg-scan" />
      <div className="app-bg-noise" />
    </div>
  );
}
