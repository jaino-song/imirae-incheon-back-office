import { SERVICE_END_NOTICE_DEFAULT_CONTENT, SERVICE_END_NOTICE_SMS_TITLE } from './service-end-notice-message';

export enum SystemTemplateKey {
  CLIENT_WELCOME = 'CLIENT_WELCOME',
  SERVICE_START_REMINDER = 'SERVICE_START_REMINDER',
  SERVICE_END_REMINDER = 'SERVICE_END_REMINDER',
  EMPLOYEE_ASSIGNED = 'EMPLOYEE_ASSIGNED',
  PRICE_INFO = 'PRICE_INFO',
  GREETING = 'GREETING',
  THANKS = 'THANKS',
  SURVEY = 'SURVEY',
  SERVICE_INFO = 'SERVICE_INFO',
  SERVICE_RECORD_LINK = 'SERVICE_RECORD_LINK',
  SERVICE_END_NOTICE = 'SERVICE_END_NOTICE',
  REMINDER = 'REMINDER',
  INFO = 'INFO',
}

export interface TemplateVariable {
  key: string;
  label: string;
  type: 'string' | 'number' | 'currency';
  required: boolean;
  description?: string;
}

export interface CustomVariable {
  key: string;
  label: string;
  required: boolean;
}

export interface TemplateContract {
  key: SystemTemplateKey;
  name: string;
  description: string;
  requiredVariables: TemplateVariable[];
  defaultContent: string;
}

export const SYSTEM_TEMPLATE_REGISTRY: Record<SystemTemplateKey, TemplateContract> = {
  [SystemTemplateKey.CLIENT_WELCOME]: {
    key: SystemTemplateKey.CLIENT_WELCOME,
    name: '고객 등록 안내',
    description: '신규 고객 등록 및 서비스 정보 안내',
    requiredVariables: [
      { key: 'clientName', label: '고객명', type: 'string', required: true },
      { key: 'registrationDate', label: '등록일', type: 'string', required: true },
      { key: 'serviceType', label: '서비스 타입', type: 'string', required: true },
    ],
    defaultContent: `[사회서비스 제공자 품질평가 A등급]
{{clientName}} 산모님~♡

인천 아이미래로에 고객 등록이 완료되었습니다 :)

등록일: {{registrationDate}}
서비스 타입: {{serviceType}}

서비스 준비 과정에서 필요한 사항은 담당자가 안내드리겠습니다.

아기의 건강과 엄마의 안정을 위해 최선을 다하겠습니다. 감사합니다.`,
  },

  [SystemTemplateKey.SERVICE_START_REMINDER]: {
    key: SystemTemplateKey.SERVICE_START_REMINDER,
    name: '서비스 시작 알림',
    description: '서비스 시작 일정 안내',
    requiredVariables: [
      { key: 'clientName', label: '고객명', type: 'string', required: true },
      { key: 'serviceStartDate', label: '서비스 시작일', type: 'string', required: true },
      { key: 'timingText', label: '발송 기준 문구', type: 'string', required: true },
    ],
    defaultContent: `[사회서비스 제공자 품질평가 A등급]
{{clientName}} 산모님~♡

산후관리서비스 시작 일정을 안내드립니다 :)

서비스 시작일: {{serviceStartDate}}
발송 기준: {{timingText}}

서비스가 원활히 시작될 수 있도록 잘 준비하겠습니다.

아기의 건강과 엄마의 안정을 위해 최선을 다하겠습니다. 감사합니다.`,
  },

  [SystemTemplateKey.SERVICE_END_REMINDER]: {
    key: SystemTemplateKey.SERVICE_END_REMINDER,
    name: '서비스 종료 알림',
    description: '서비스 종료 일정 안내',
    requiredVariables: [
      { key: 'clientName', label: '고객명', type: 'string', required: true },
      { key: 'serviceEndDate', label: '서비스 종료일', type: 'string', required: true },
      { key: 'timingText', label: '발송 기준 문구', type: 'string', required: true },
    ],
    defaultContent: `[사회서비스 제공자 품질평가 A등급]
{{clientName}} 산모님~♡

산후관리서비스 종료 일정을 안내드립니다.

서비스 종료일: {{serviceEndDate}}
발송 기준: {{timingText}}

남은 서비스 기간도 편안하고 만족스럽게 이용하실 수 있도록 최선을 다하겠습니다 :)

아기의 건강과 엄마의 안정을 위해 최선을 다하겠습니다. 감사합니다.`,
  },

  [SystemTemplateKey.EMPLOYEE_ASSIGNED]: {
    key: SystemTemplateKey.EMPLOYEE_ASSIGNED,
    name: '직원 배정 알림',
    description: '관리사에게 고객 배정 및 서비스 시작 일정 안내',
    requiredVariables: [
      { key: 'employeeName', label: '직원명', type: 'string', required: true },
      { key: 'clientName', label: '고객명', type: 'string', required: true },
      { key: 'serviceStartDate', label: '서비스 시작일', type: 'string', required: true },
    ],
    defaultContent: `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

{{employeeName}} 관리사님께 {{clientName}} 산모님 서비스가 배정되었습니다.

서비스 시작일: {{serviceStartDate}}

서비스 시작 전 고객 정보와 일정을 확인해 주세요.

감사합니다.`,
  },

  [SystemTemplateKey.PRICE_INFO]: {
    key: SystemTemplateKey.PRICE_INFO,
    name: '비용 안내',
    description: '정부지원 바우처 서비스 비용 및 입금 계좌 안내',
    requiredVariables: [
      {
        key: 'name',
        label: '산모님 성함',
        type: 'string',
        required: true,
        description: '메시지 상단 호칭에 사용',
      },
      {
        key: 'weeks',
        label: '출퇴근 주수',
        type: 'number',
        required: true,
        description: '서비스 기간(주) 표기용',
      },
      {
        key: 'duration',
        label: '평일 기준 일수',
        type: 'string',
        required: true,
        description: '서비스 기간(일) 표기용',
      },
      {
        key: 'type',
        label: '바우처 유형',
        type: 'string',
        required: true,
        description: '정부지원 바우처 유형명',
      },
      {
        key: 'fullPrice',
        label: '총 서비스 금액',
        type: 'currency',
        required: true,
        description: '원 단위 금액(문구에 "원"이 붙음)',
      },
      {
        key: 'grant',
        label: '정부 지원금액',
        type: 'currency',
        required: true,
        description: '원 단위 금액(문구에 "원"이 붙음)',
      },
      {
        key: 'actualPrice',
        label: '본인 부담금',
        type: 'currency',
        required: true,
        description: '원 단위 금액(문구에 "원"이 붙음)',
      },
      {
        key: 'bankName',
        label: '입금 은행명',
        type: 'string',
        required: true,
      },
      {
        key: 'accNum',
        label: '입금 계좌번호',
        type: 'string',
        required: true,
      },
    ],
    defaultContent: `[사회서비스 제공자 품질평가 A등급]

{{name}} 산모님~♡ 

정부지원 바우처 서비스 비용 관련해서 안내 드립니다 :)

서비스 기간: 
출퇴근 {{weeks}}주 (평일기준 {{duration}}일)
정부지원 바우처 유형: 
{{type}}

기본 서비스 금액은 
총 {{fullPrice}}원이며, 
정부 지원금액은 
{{grant}}원 입니다.

산모님께서 부담하시는 금액은 
{{actualPrice}}원 입니다.

서비스 예약을 위해 
선납하실 예약금은 
100,000원 입니다.

예약금 입금 후에 
서비스 예약이 확정 됩니다.

입금 계좌번호: 
{{bankName}} {{accNum}}
예금주: 인천 아이미래로 (김정인)

입금시 입금자명을 꼭 기재해 주세요 :)
(타인 계좌에서 송금시 산모님 성함 기재 필수)

아기의 건강과 엄마의 안정을 위해 최선을 다하겠습니다. 감사합니다.`,
  },

  [SystemTemplateKey.GREETING]: {
    key: SystemTemplateKey.GREETING,
    name: '인사(소개)',
    description: '초기 문의 시 업체 소개 및 연락처/사이트 안내',
    requiredVariables: [],
    defaultContent: `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)
            
인천 아이미래로는 아기들의 건강과 엄마들의 안정을 최우선으로 하는 전문적인 산모 및 신생아 관리프로그램을 약속드립니다.
            
▶문의
남동구, 연수구, 동구, 중구
- 032-442-5992
            
서구, 검단구 
- 032-327-6992
            
부평구, 미추홀구 
- 032-262-5992
            
▶공식사이트
www.imirae-incheon.com
        
▶서비스 후기 더 보기
blog.naver.com/imirae-incheon`,
  },

  [SystemTemplateKey.THANKS]: {
    key: SystemTemplateKey.THANKS,
    name: '예약 완료(입금 확인)',
    description: '입금 확인 후 예약 완료 및 감사 안내',
    requiredVariables: [
      {
        key: 'name',
        label: '산모님 성함',
        type: 'string',
        required: true,
      },
    ],
    defaultContent: `[사회서비스 제공자 품질평가 A등급]

{{name}} 산모님 ~♡

입금이 확인되어 예약이 완료되었습니다. 산모님의 서비스를 잘 준비하고 있겠습니다. 예쁜 아가 순산하시면 연락주세요 :)

아기의 건강과 엄마의 안정을 위해 최선을 다하겠습니다. 감사합니다.`,
  },

  [SystemTemplateKey.SERVICE_END_NOTICE]: {
    key: SystemTemplateKey.SERVICE_END_NOTICE,
    name: SERVICE_END_NOTICE_SMS_TITLE,
    description: '서비스 종료 후 바우처 산모에게 본인부담금 영수증 다운로드 링크를 안내',
    requiredVariables: [
      { key: 'name', label: '산모님 성함', type: 'string', required: true },
      { key: 'receiptUrl', label: '영수증 링크', type: 'string', required: true },
    ],
    defaultContent: SERVICE_END_NOTICE_DEFAULT_CONTENT,
  },

  [SystemTemplateKey.SURVEY]: {
    key: SystemTemplateKey.SURVEY,
    name: '모니터링 설문',
    description: '서비스 이용 모니터링 설문 링크 발송',
    requiredVariables: [
      {
        key: 'name',
        label: '산모님 성함',
        type: 'string',
        required: true,
      },
    ],
    defaultContent: `[사회서비스 제공자 품질평가 A등급]

{{name}} 산모님 ~♡

서비스 받으시는 기간 동안 행복한 시간이 되셨나요?

산모신생아건강관리서비스 이용에 대한 모니터링 설문 링크 보내드립니다~ 서비스 종료에 꼭 필요한 단계이오니 7일 이내로 모니터링 설문을 완료해 주세요~

산모님 가정에 항상 행복과 평안이 가득하길 바라겠습니다 :)

모니터링 설문 링크: https://naver.me/5S9fl3OP

아기의 건강과 엄마의 안정을 위해 최선을 다하겠습니다. 감사합니다.`,
  },

  [SystemTemplateKey.SERVICE_INFO]: {
    key: SystemTemplateKey.SERVICE_INFO,
    name: '서비스 안내',
    description: '산후관리서비스 진행 전 주요 안내사항 전달',
    requiredVariables: [
      {
        key: 'name',
        label: '산모님 성함',
        type: 'string',
        required: true,
      },
    ],
    defaultContent: `[사회서비스 제공자 품질평가 A등급]
{{name}} 산모님~♡

산후관리서비스 관련 안내사항을 보내드립니다 :)

1. 관리사님의 근무시간은 오전 9시부터 오후 6시까지이며 점심 식사 시간이 포함된 1시간 휴게시간이 있습니다. 휴게시간은 산모님과 관리사님이 서로 잘 조율하셔서 사용하시면 됩니다.

2. 관리사님께서 하시는 주 업무는 신생아 케어 (신생아 목욕, 신생아 빨래, 수유, 젖병 삶기 등), 산모 음식 준비, 아기와 산모가 머무는 방의 청소와 거실과 화장실의 간단한 청소 등의 일들을 하시는데 묵은 빨래, 대청소, 베란다 청소 등의 과중한 일들은 하지 않습니다.

3. 산모님께서 도움이 필요한 일이 생겼을 시에, 제공 서비스 범위 내에서 최대한 도와드립니다. 그리고 산모님께서 젖몸살이 오면 케어해주십니다.

4. 궁금하신 점 있으시면 언제든지 문자 또는 연락 주세요 :)

아기의 건강과 엄마의 안정을 위해 최선을 다하겠습니다. 감사합니다.`,
  },

  [SystemTemplateKey.SERVICE_RECORD_LINK]: {
    key: SystemTemplateKey.SERVICE_RECORD_LINK,
    name: '제공기록지 작성 링크',
    description: '서비스 시작일 오후 3시에 제공인력에게 발송되는 제공기록지 작성 링크 SMS',
    requiredVariables: [
      {
        key: 'employeeName',
        label: '관리사님 성함',
        type: 'string',
        required: true,
        description: '제공기록지를 작성할 관리사명',
      },
      {
        key: 'clientName',
        label: '산모님 성함',
        type: 'string',
        required: true,
        description: '제공기록지 대상 고객명',
      },
      {
        key: 'serviceStartDate',
        label: '서비스 시작일',
        type: 'string',
        required: true,
        description: '배정된 서비스 시작일',
      },
      {
        key: 'serviceRecordUrl',
        label: '제공기록지 링크',
        type: 'string',
        required: true,
        description: '제공인력이 작성할 제공기록지 링크',
      },
    ],
    defaultContent: `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

{{employeeName}} 관리사님, {{clientName}} 산모님의 {{serviceStartDate}} 시작 서비스 제공기록지 작성 링크입니다.
매일 서비스 제공 완료 직전에 서비스 세부사항 기록 후에, 산모님께 승인을 받으시면 됩니다.

최초 접속 시에 관리사님의 전화번호 인증이 필요합니다. 링크 접속 후 휴대폰 번호로 본인확인하고, 방문일마다 기록을 남겨주세요.

감사합니다.

제공기록지 링크
{{serviceRecordUrl}}`,
  },

  [SystemTemplateKey.REMINDER]: {
    key: SystemTemplateKey.REMINDER,
    name: '리마인드',
    description: '상담/예약 진행 중 고객 리마인드 및 안심 메시지',
    requiredVariables: [
      {
        key: 'name',
        label: '산모님 성함',
        type: 'string',
        required: true,
      },
    ],
    defaultContent: `[사회서비스 제공자 품질평가 A등급]
{{name}} 산모님~♡

아가 예뻐하시고 케어 잘하시는 
프리미엄급 관리사님으로 매칭 되도록 최대한 신경쓰겠습니다~

저도 서비스가 종료되는 때까지 산모님께서 
편안하고 행복하게 서비스 받으시는지 
지속적으로 체크하고 신경 써서 
산모님께서 만족하시는 서비스가 되도록 최선을 다하겠습니다 :)

가족 분들과 편히 상의하시고 말씀해 주세요~ 연락 기다리겠습니다 :) 

아기의 건강과 엄마의 안정을 위해 최선을 다하겠습니다. 감사합니다.`,
  },

  [SystemTemplateKey.INFO]: {
    key: SystemTemplateKey.INFO,
    name: '정보 요청',
    description: '서비스 전 산모/아기 기본 정보 작성 요청',
    requiredVariables: [],
    defaultContent: `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)
        
서비스 진행 전 산모님과 아기의 정보를 파악하여 만족스런 서비스를 제공해드릴 수 있도록 하고 있습니다.

아래의 내용들은 서비스 진행에 필요하오니 작성을 부탁드립니다. 질문에 해당사항이 없는 것은 작성하지 않으셔도 됩니다.
        
*산모님 성함 :
*산모님 생년월일 :
*산모님 주소 :
*산모님 연락처 :
*조리원 여부 :
*출산일 :
*자연분만/제왕절개 :
*초산/경산 :
*남아/여아 :
*모유수유/분유수유/혼합수유 :
        
아기의 건강과 엄마의 안정을 위해 최선을 다하겠습니다. 감사합니다.`,
  },
};
