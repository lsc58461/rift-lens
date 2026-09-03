"use client";

// 주소창에 /summoner/kr/이름#태그 처럼 '#'을 그대로 치면 브라우저가 '#태그'를 프래그먼트로 취급해
// 서버에 보내지 않는다 → 서버는 태그 없는 검색으로 보고 "잘못된 형식"을 낸다. 클라이언트에서
// location.hash 를 읽어 정식 주소(이름-태그)로 바꿔 보낸다 (서버는 프래그먼트를 볼 수 없어 여기서만 가능).
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function HashFix() {
  const router = useRouter();
  useEffect(() => {
    const tag = location.hash.slice(1).trim();
    if (!tag) return;
    router.replace(`${location.pathname}-${encodeURIComponent(tag)}${location.search}`);
  }, [router]);
  return null;
}
