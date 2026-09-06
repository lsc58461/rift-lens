"use client";

// 주소창에 /summoner/kr/이름#태그 처럼 '#'을 그대로 치면 브라우저가 '#태그'를 프래그먼트로 취급해
// 서버에 보내지 않는다 → 서버는 태그 없는 검색으로 보고 "잘못된 형식"을 낸다. 클라이언트에서
// location.hash 를 읽어 정식 주소(이름-태그)로 바꿔 보낸다 (서버는 프래그먼트를 볼 수 없어 여기서만 가능).
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { safeDecode } from "@/lib/summoner-url";

export function HashFix() {
  const router = useRouter();
  useEffect(() => {
    // location.hash 는 브라우저가 이미 퍼센트 인코딩해서 준다("#육수마스터" → "#%EC%9C%A1…").
    // 그대로 다시 encodeURIComponent 하면 %25EC… 로 이중 인코딩돼 엉뚱한 태그가 된다(2026-09-06 실제 발생).
    // 먼저 풀고 한 번만 인코딩한다.
    const tag = safeDecode(location.hash.slice(1)).trim();
    if (!tag) return;
    router.replace(`${location.pathname}-${encodeURIComponent(tag)}${location.search}`);
  }, [router]);
  return null;
}
