import Link from "next/link";
import { ScrollText } from "lucide-react";
import { LegalDoc, LegalSection } from "@/components/legal-doc";

export const metadata = {
  title: "이용약관",
  description: "Rift Lens 서비스 이용약관",
};

const EFFECTIVE = "2026년 8월 25일";

export default function TermsPage() {
  return (
    <LegalDoc
      icon={<ScrollText className="size-4.5" />}
      title="이용약관"
      subtitle={`시행일 ${EFFECTIVE}`}
    >
      <LegalSection title="제1조 (목적)">
        <p>
          이 약관은 이정윤(이하 &quot;운영자&quot;)이 제공하는 Rift Lens 웹사이트(https://rift-lens.xyz)
          및 이에 연동된 카카오톡 채널 챗봇, 디스코드 봇(이하 통칭 &quot;서비스&quot;)의 이용 조건과
          절차, 이용자와 운영자의 권리·의무를 정하는 것을 목적으로 합니다.
        </p>
      </LegalSection>

      <LegalSection title="제2조 (서비스의 내용)">
        <ul>
          <li>
            리그 오브 레전드 한국 서버 소환사의 공개 전적 데이터를 집계한 매칭 구간(최근 경기
            로비의 평균 랭크), 전적·랭크 추이 조회, 챔피언 통계, 팀·듀오 분석 등 정보 제공
          </li>
          <li>카카오톡 챗봇·디스코드 봇을 통한 위 정보의 조회 및 알림</li>
          <li>서비스는 무료로 제공되며 광고나 유료 기능이 없습니다.</li>
        </ul>
        <p>
          운영자는 서비스의 내용을 사전 고지 후 변경하거나, 운영상·기술상 필요에 따라 일부 또는
          전부를 중단할 수 있습니다. 중단 시 가능한 범위에서 업데이트 내역 페이지 등으로 안내합니다.
        </p>
      </LegalSection>

      <LegalSection title="제3조 (정보의 성격과 책임의 한계)">
        <ul>
          <li>
            서비스가 제공하는 &quot;매칭 구간&quot;, 챔피언 티어·점수 등은 공개 랭크·경기 데이터를
            통계적으로 집계한 <b>참고용 수치</b>이며, 라이엇 게임즈의 공식 등급이나 매치메이킹
            수치가 아니고 이를 대체하지 않습니다.
          </li>
          <li>
            데이터는 Riot Games API를 통해 수집되며, 원천 데이터의 지연·누락·변경으로 인해 실제와
            다를 수 있습니다. 운영자는 정보의 정확성·완전성·적시성을 보증하지 않습니다.
          </li>
          <li>
            이용자가 서비스의 정보를 근거로 내린 판단과 그 결과에 대해 운영자는 고의 또는 중대한
            과실이 없는 한 책임을 지지 않습니다.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="제4조 (이용자의 의무)">
        <p>이용자는 다음 행위를 해서는 안 됩니다.</p>
        <ul>
          <li>자동화 도구·봇·스크래핑 등으로 서비스에 과도한 요청을 보내거나 정상 운영을 방해하는 행위</li>
          <li>서비스의 데이터를 무단으로 대량 수집·복제·재배포하거나 상업적으로 이용하는 행위</li>
          <li>서비스의 정보를 이용해 타인을 비방·괴롭히거나 게임 내외에서 불이익을 주는 행위</li>
          <li>관련 법령, Riot Games 이용약관, 카카오·디스코드 등 플랫폼 정책에 위반되는 행위</li>
        </ul>
        <p>위반 시 운영자는 사전 통지 없이 해당 이용자의 접근을 제한할 수 있습니다.</p>
      </LegalSection>

      <LegalSection title="제5조 (지식재산권)">
        <ul>
          <li>
            서비스의 구성, 디자인, 소스코드, 집계 알고리즘 및 가공된 통계 자료에 대한 권리는
            운영자에게 있습니다.
          </li>
          <li>
            챔피언·아이템·룬 이미지 및 명칭 등 게임 관련 자산은 Riot Games, Inc.의 자산이며,
            Riot Games의 <a href="https://www.riotgames.com/ko/legal" target="_blank" rel="noreferrer">
              법적 고지(Legal Jibber Jabber)
            </a> 정책에 따라 사용됩니다.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="제6조 (Riot Games 관련 고지)">
        <p>
          Rift Lens는 Riot Games의 승인을 받지 않았으며, Riot Games 또는 리그 오브 레전드의 제작·관리에
          공식적으로 관여하는 자의 견해나 의견을 반영하지 않습니다. Riot Games 및 관련 자산은 Riot
          Games, Inc.의 상표 또는 등록상표입니다.
        </p>
        <p className="text-muted-foreground">
          Rift Lens isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of Riot
          Games or anyone officially involved in producing or managing Riot Games properties. Riot Games,
          and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
        </p>
      </LegalSection>

      <LegalSection title="제7조 (개인정보)">
        <p>
          운영자는 개인정보를 최소한으로 처리하며, 자세한 내용은{" "}
          <Link href="/privacy">개인정보처리방침</Link>을 따릅니다.
        </p>
      </LegalSection>

      <LegalSection title="제8조 (약관의 변경)">
        <p>
          운영자는 관련 법령을 위반하지 않는 범위에서 이 약관을 변경할 수 있으며, 변경 시 시행일과
          변경 내용을 서비스 내(업데이트 내역 또는 본 페이지)에 시행일 7일 전부터 공지합니다.
          변경된 약관 시행 후 서비스를 계속 이용하면 변경에 동의한 것으로 봅니다.
        </p>
      </LegalSection>

      <LegalSection title="제9조 (준거법 및 분쟁 해결)">
        <p>
          이 약관은 대한민국 법령에 따라 해석되며, 서비스 이용과 관련한 분쟁은 먼저 아래 연락처를 통한
          협의로 해결하고, 협의가 이루어지지 않을 경우 민사소송법에 따른 관할 법원에 제기합니다.
        </p>
      </LegalSection>

      <LegalSection title="부칙">
        <ul>
          <li>이 약관은 {EFFECTIVE}부터 시행합니다.</li>
          <li>
            운영자: 이정윤 · 문의:{" "}
            <a href="mailto:riftlens.contact@gmail.com">riftlens.contact@gmail.com</a>
          </li>
        </ul>
      </LegalSection>
    </LegalDoc>
  );
}
