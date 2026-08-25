import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { LegalDoc, LegalSection } from "@/components/legal-doc";

export const metadata = {
  title: "개인정보처리방침",
  description: "Rift Lens 개인정보처리방침",
};

const EFFECTIVE = "2026년 8월 25일";

export default function PrivacyPage() {
  return (
    <LegalDoc
      icon={<ShieldCheck className="size-4.5" />}
      title="개인정보처리방침"
      subtitle={`시행일 ${EFFECTIVE}`}
    >
      <LegalSection title="1. 개요">
        <p>
          이정윤(이하 &quot;운영자&quot;)은 Rift Lens 웹사이트(https://rift-lens.xyz)와 카카오톡 채널 챗봇,
          디스코드 봇(이하 &quot;서비스&quot;)을 운영하며, 「개인정보 보호법」 등 관련 법령에 따라 이용자의
          개인정보를 보호합니다. 서비스는 회원가입이나 로그인 없이 이용할 수 있으며, 이름·연락처·계정
          정보 등 이용자를 직접 식별할 수 있는 개인정보를 수집하지 않습니다.
        </p>
      </LegalSection>

      <LegalSection title="2. 처리하는 정보와 목적">
        <ul>
          <li>
            <b>이용자가 입력한 소환사명(라이엇 ID)</b> — 전적·매칭 구간 조회를 위해 처리하며, 조회된
            소환사명은 &quot;최근 검색&quot; 표시와 데이터 갱신을 위해 보관됩니다. 이는 게임 내 공개
            식별자로, 운영자는 이를 특정 개인과 연결하지 않습니다.
          </li>
          <li>
            <b>리그 오브 레전드 공개 전적 데이터</b> — Riot Games API로부터 받은 경기 기록, 랭크, 챔피언
            정보 등 공개 데이터. 매칭 구간 집계와 통계 산출을 위해 보관·가공합니다.
          </li>
          <li>
            <b>서비스 이용 기록</b> — 조회 시각, 조회 경로(웹/도구/챗봇) 등 서비스 개선과 이용량
            파악을 위한 통계 정보. 개인을 식별하지 않는 형태로 처리합니다.
          </li>
          <li>
            <b>접속 로그</b> — 서버 보안과 장애 대응을 위해 웹서버가 IP 주소, 접속 시각, 요청 URL,
            브라우저 정보를 자동으로 기록하며, 단기간 보관 후 삭제됩니다.
          </li>
          <li>
            <b>문의·버그 신고</b> — 문의 페이지로 접수하면 답변을 위해 이메일 주소, 문의 내용, 선택
            입력한 소환사명, 접수 당시 페이지 주소·브라우저 정보·IP 주소를 저장합니다. 이메일은 답변
            목적으로만 사용하며 마케팅에 쓰지 않습니다.
          </li>
          <li>
            <b>카카오톡 챗봇</b> — 카카오 플랫폼이 전달하는 발화 내용(입력한 소환사명)만 조회에 사용하며,
            카카오 이용자 식별자, 프로필, 전화번호 등은 저장하지 않습니다.
          </li>
          <li>
            <b>디스코드 봇</b> — 알림 채널 설정을 위해 봇이 초대된 서버(길드) ID, 채널 ID, 설정을
            실행한 관리자의 디스코드 사용자 ID를 저장합니다. 명령어로 입력된 소환사명은 조회에만 사용하며,
            그 외 디스코드 이용자의 메시지·프로필 등은 수집하지 않습니다.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. 쿠키">
        <p>
          서비스는 광고·추적 목적의 쿠키를 사용하지 않습니다. 안정적인 서비스 제공을 위한 기능성 쿠키
          (예: 서버 분산 처리용 세션 유지 쿠키)와 운영자 관리 화면 로그인용 쿠키만 사용하며, 이는
          이용자를 식별하거나 행동을 추적하는 데 쓰이지 않습니다.
        </p>
      </LegalSection>

      <LegalSection title="4. 보관 기간">
        <ul>
          <li>공개 전적 데이터와 조회된 소환사명: 서비스 제공과 통계 정확도 유지를 위해 서비스 운영 기간 동안 보관</li>
          <li>접속 로그: 보안 목적 달성 후 지체 없이 삭제 (통상 30일 이내)</li>
          <li>문의 접수 내용: 답변 완료 후 1년 이내 삭제, 삭제 요청 시 즉시 삭제</li>
          <li>디스코드 서버·채널·설정자 ID: 봇이 해당 서버에서 제거되거나 알림을 해제할 때까지</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. 제3자 제공 및 처리 위탁">
        <p>
          운영자는 수집한 정보를 제3자에게 판매하거나 제공하지 않습니다. 다만 서비스 제공을 위해 다음
          외부 서비스를 이용하며, 각 서비스는 자체 정책에 따라 정보를 처리합니다.
        </p>
        <ul>
          <li>Riot Games API — 공개 전적 데이터 조회 (Riot Games 개인정보처리방침 적용)</li>
          <li>카카오 i 오픈빌더 — 카카오톡 챗봇 메시지 송수신 (카카오 개인정보처리방침 적용)</li>
          <li>Discord — 디스코드 봇 메시지 송수신</li>
          <li>Oracle Cloud Infrastructure — 서버 및 데이터베이스 호스팅 (일본 도쿄 리전)</li>
        </ul>
        <p>
          서버가 국외(일본)에 위치하므로 위 정보는 해당 지역에 저장됩니다. 저장되는 정보는 앞서 밝힌
          대로 개인을 직접 식별하지 않는 공개 게임 데이터와 통계 정보에 한정됩니다.
        </p>
      </LegalSection>

      <LegalSection title="6. 이용자의 권리">
        <p>
          이용자는 자신의 소환사명이 서비스에 노출되지 않기를 원할 경우 아래 연락처로 요청할 수 있으며,
          운영자는 본인 확인 후 지체 없이 해당 소환사의 조회 결과 및 최근 검색 노출을 제한합니다.
          그 외 정보의 열람·정정·삭제 요청도 같은 경로로 접수합니다.
        </p>
      </LegalSection>

      <LegalSection title="7. 안전성 확보 조치">
        <ul>
          <li>모든 통신은 HTTPS로 암호화됩니다.</li>
          <li>데이터베이스와 캐시는 외부에서 접근할 수 없는 내부 네트워크에만 연결됩니다.</li>
          <li>관리 기능은 별도 인증을 거친 운영자만 접근할 수 있습니다.</li>
          <li>Riot Games가 제공하는 플레이어 식별자(PUUID)는 API 키 단위로 암호화된 값으로만 보관됩니다.</li>
        </ul>
      </LegalSection>

      <LegalSection title="8. 아동의 개인정보">
        <p>
          서비스는 만 14세 미만 아동을 대상으로 하지 않으며, 아동의 개인정보를 의도적으로 수집하지
          않습니다.
        </p>
      </LegalSection>

      <LegalSection title="9. 개인정보 보호책임자 및 문의">
        <ul>
          <li>개인정보 보호책임자: 이정윤</li>
          <li>
            이메일: <a href="mailto:riftlens.contact@gmail.com">riftlens.contact@gmail.com</a>
          </li>
        </ul>
        <p>
          개인정보 침해에 대한 신고·상담은 개인정보침해신고센터(privacy.kisa.or.kr, 국번 없이 118)에서도
          받고 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="10. 방침의 변경">
        <p>
          이 방침은 법령·서비스 변경에 따라 수정될 수 있으며, 변경 시 시행일과 내용을 본 페이지 및{" "}
          <Link href="/updates">업데이트 내역</Link>에 공지합니다. 서비스 이용에 관한 일반 조건은{" "}
          <Link href="/terms">이용약관</Link>을 참고하세요.
        </p>
        <ul>
          <li>이 방침은 {EFFECTIVE}부터 시행합니다.</li>
        </ul>
      </LegalSection>
    </LegalDoc>
  );
}
