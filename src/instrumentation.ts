// 서버 수명주기 훅 — 배포(컨테이너 교체)로 백그라운드 작업이 끊기지 않게 한다.
// 이 파일은 Node·Edge 두 번들에 모두 컴파일되므로 Node API를 직접 쓰지 않고,
// 런타임을 확인한 뒤에만 Node 전용 모듈을 동적 import한다(Edge 번들 에러 방지).
// 실제 로직은 ./instrumentation-node.ts 참고.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerNode } = await import("./instrumentation-node");
  registerNode();
}
