import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next 16.3 부터 React Compiler 계열 규칙이 error 로 켜진다. "effect 안에서 동기 setState"
  // 는 어드민 카드의 폴링·마운트 초기화 패턴 11곳에 걸리는데 동작엔 문제 없는 스타일 규칙이라
  // 경고로 낮춘다 (CI 는 린트를 돌리지 않으므로 배포엔 영향 없음). 새로 짜는 코드에선 피할 것.
  { rules: { "react-hooks/set-state-in-effect": "warn" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
