import type { Branch, Campaign, Change, DemoData, DemoTask, Person } from './model';
import { createClientSheet, readClientSheetInputs, reservationForm } from './sheet';
import { reservationScheduleSheet } from './policy';
export const campaigns: Campaign[] = [
  {
    id: 'autumn',
    name: '미모드림 · 10월 방문협찬',
    clientId: 'mimo',
    startsOn: '2026-10-01',
    endsOn: '2026-10-31',
  },
  {
    id: 'winter',
    name: '미모드림 · 연말 캠페인',
    clientId: 'mimo',
    startsOn: '2026-12-21',
    endsOn: '2026-12-31',
  },
  {
    id: 'skin',
    name: '온유 · 가을 스킨케어',
    clientId: 'onyu',
    startsOn: '2026-09-21',
    endsOn: '2026-09-30',
  },
];
export const clients = [
  { id: 'mimo', name: '미모드림 클리닉' },
  { id: 'onyu', name: '온유 클리닉' },
];
export const SAMPLE_SOURCE =
  '1. 希望日時：2026年10月28日 16:00（韓国時間）\n2. 初診\n3. kondo sae（곤도 사에）\n4. 女性\n5. 1999-09-18\n6. 韓国語：難しい\n7. ウルセラ';
export const SAMPLE_FIELDS = {
  preferred: '2026-10-28T16:00',
  visitType: '초진',
  name: '곤도 사에(kondo sae)',
  gender: '여',
  birthDate: '1999-09-18',
  koreanAbility: '불가능',
  treatment: '울쎄라',
};
export const DEFAULT_TEMPLATE =
  '@{{handle}}\nhttps://x.com/{{handle}}?s=20\n\n1. 희망 일시: {{preferred}}\n2. 초진/재진: {{visitType}}\n3. 이름(한글/로마자): {{name}}\n4. 성별: {{gender}}\n5. 생년월일: {{birthDate}}\n6. 한국어 가능 여부: {{koreanAbility}}\n7. 희망 시술 내용: {{treatment}}';
export function makeBranch(id: string, clientId: string, name: string, order = 1): Branch {
  return {
    id,
    clientId,
    name,
    scope: 'branch',
    setupPending: false,
    order,
    active: true,
    week: Array.from({ length: 7 }, (_, i) => ({
      closed: i === 0,
      intervals: i === 6 ? '10:00-14:00' : '10:00-13:00, 14:00-19:00',
    })),
    holiday: 'closed',
    holidayHours: '10:00-14:00',
    exceptions: [
      { date: '2026-10-09', closed: false, intervals: '10:00-14:00', note: '한글날 특별 운영' },
      { date: '2026-10-14', closed: true, intervals: '', note: '내부 교육 · 임시 휴무' },
    ],
    naver: 'https://map.naver.com/p/search/강남역',
    google: 'https://www.google.com/maps/search/?api=1&query=강남역',
    instructions: {
      KO: '{{clinic}} {{branch}}입니다. 방문 10분 전에 도착해 주세요.\n네이버 지도: {{naver}}',
      JA: '{{clinic}} {{branch}}です。10分前にお越しください。\nGoogle Maps: {{google}}',
      EN: 'Please arrive at {{clinic}} {{branch}} 10 minutes early.\n{{google}}',
    },
    form: reservationForm,
    sheetTemplate: DEFAULT_TEMPLATE,
  };
}
const changes = (count: number, preferred: string): Change[] => {
  const day = new Date(`${preferred.slice(0, 10)}T00:00:00Z`);
  const shifted = (delta: number) => {
    const date = new Date(day);
    date.setUTCDate(date.getUTCDate() + delta);
    return `${date.toISOString().slice(0, 10)}T${preferred.slice(11, 16)}`;
  };
  return Array.from({ length: count }, (_, i) => ({
    id: `sample-change-${i}`,
    reason: 'customer_request',
    at: `2026-10-0${i + 1}T04:00:00.000Z`,
    differences: [
      { field: 'preferred', label: '희망 일시', before: shifted(i - count), after: shifted(i - count + 1) },
    ],
  }));
};
export function makeTask(id: string, personId = 'hana', campaignId = 'autumn'): DemoTask {
  return {
    id,
    campaignId,
    personId,
    type: 'visit',
    flow: 'prep',
    visitOn: '',
    scheduledOn: '2026-11-06',
    note: '',
    amount: '30000',
    currency: 'JPY',
    noCost: false,
    posted: false,
    paid: false,
    settlementActive: false,
    visited: false,
  };
}
export function seedData(): DemoData {
  const people: Person[] = [
    {
      id: 'hana',
      name: '하나',
      handle: 'hana_mozu',
      memo: '일본어로 소통 · 평일 오후 방문을 선호해요.',
      currency: 'JPY',
      pricing: { visit: '30000', post: '20000', rt: '0', quoteRt: '' },
      priceHistory: [],
    },
    {
      id: 'yui',
      name: '유이',
      handle: 'yui_diary',
      memo: '방문 전 위치 안내를 한 번 더 보내 주세요.',
      currency: 'KRW',
      pricing: { visit: '250000', post: '150000', rt: '30000', quoteRt: '50000' },
      priceHistory: [],
    },
    {
      id: 'mika',
      name: '미카',
      handle: 'mika_sample',
      memo: '',
      currency: 'JPY',
      pricing: { visit: '', post: '', rt: '', quoteRt: '' },
      priceHistory: [],
    },
  ];
  const book = (
    id: string,
    personId: string,
    phase: 'waiting' | 'confirmed',
    count: number,
    preferred = '2026-10-28T16:00',
    campaignId = 'autumn',
  ): DemoTask => {
    const p = people.find((p) => p.id === personId)!;
    const sheet = reservationScheduleSheet(
      createClientSheet(p, {
        ...SAMPLE_FIELDS,
        preferred,
        name: personId === 'hana' ? SAMPLE_FIELDS.name : '유이(yui)',
      }),
    );
    return {
      ...makeTask(id, personId, campaignId),
      visitOn: phase === 'confirmed' ? preferred.slice(0, 10) : '',
      scheduledOn: readClientSheetInputs(sheet).uploadDeadline,
      note: '샘플 예약입니다. 시술 전 상담이 필요해요.',
      reservation: {
        branchId: 'gangnam',
        source: SAMPLE_SOURCE,
        sheet: `${sheet}\n\n전달 메모: 동반자 1명은 상담만 진행합니다.`,
        phase,
        history: changes(count, preferred),
      },
    };
  };
  const pending = book('visit-waiting', 'hana', 'waiting', 0);
  const confirmed = book('visit-confirmed', 'yui', 'confirmed', 2, '2026-10-08T16:00');
  const limit = book('visit-limit', 'hana', 'confirmed', 3, '2026-10-23T14:00');
  limit.reservation!.history.splice(1, 0, {
    id: 'fix-1',
    reason: 'correction',
    at: '2026-10-01T07:00:00Z',
    differences: [{ field: 'name', label: '이름', before: '곤도', after: SAMPLE_FIELDS.name }],
  });
  limit.reservation!.history.unshift({ id: 'legacy', reason: 'correction', at: '2026-09-29T01:00:00Z' });
  const cancelled = book('visit-cancelled', 'yui', 'confirmed', 1);
  cancelled.end = { kind: '취소', reason: '인플루언서 일정 취소', at: '2026-10-03T05:00:00Z' };
  const noshow = book('visit-noshow', 'hana', 'confirmed', 0);
  noshow.end = { kind: '노쇼', reason: '연락 없이 미방문', at: '2026-10-03T07:00:00Z' };
  return {
    people,
    draftLibrary: [
      {
        id: 'available-visit-guide',
        personId: 'hana',
        title: 'クリニック訪問のご案内',
        body: '【PR】韓国のクリニックへ伺う予定です。\n当日の流れやカウンセリングで確認したことを、訪問後にまとめます。',
        status: 'draft',
        createdOn: '2026-10-02',
      },
      {
        id: 'available-visit-review',
        personId: 'hana',
        title: 'カウンセリングの振り返り',
        body: '【PR】今回のカウンセリングで相談したことをまとめます。\n［実際に相談した内容・当日の感想を記入］',
        status: 'draft',
        createdOn: '2026-10-03',
      },
    ],
    clinicInfo: {
      mimo: { info: '', banned: '', memo: '일본어 방문 안내를 함께 전달해 주세요.' },
      onyu: { info: '', banned: '', memo: '' },
    },
    branches: [
      { ...makeBranch('gangnam', 'mimo', '본점'), scope: 'clinic' },
      {
        ...makeBranch('onyu-main', 'onyu', '본점'),
        scope: 'clinic',
        holiday: 'unknown',
        naver: '',
        google: '',
        exceptions: [],
      },
    ],
    tasks: [
      pending,
      confirmed,
      limit,
      { ...makeTask('visit-legacy'), visitOn: '2026-10-12', visited: true },
      book('visit-yearend', 'hana', 'waiting', 0, '2026-12-28T15:00', 'winter'),
      {
        ...makeTask('content-free', 'hana', 'skin'),
        type: 'post',
        noCost: true,
        amount: '',
        draft: {
          title: '秋のスキンケア、最近のルーティン',
          body: '季節の変わり目に、毎日のスキンケアを見直しています。\n肌の調子に合わせて、無理なく続けられるケアを。',
          status: 'draft',
          createdOn: '2026-10-01',
        },
      },
      {
        ...makeTask('content-paid', 'hana', 'skin'),
        type: 'quoteRt',
        amount: '20000',
        posted: true,
        settlementActive: true,
        draft: {
          title: '韓国で見つけた、お気に入りのスキンケア',
          body: '韓国で見つけたスキンケアを紹介します。\n使い心地や毎日のケアについて、詳しくまとめました。',
          status: 'delivered',
          createdOn: '2026-09-22',
        },
      },
      { ...makeTask('content-done', 'hana', 'skin'), type: 'rt', amount: '0', posted: true, noCost: true },
      cancelled,
      noshow,
    ],
    messages: [
      {
        id: 'welcome',
        title: '협찬 제안',
        language: 'JA',
        body: '{{handle}} 様\nこんにちは。施術のご協力についてご相談させてください。',
        order: 1,
        active: true,
      },
      {
        id: 'remind',
        title: '방문 하루 전 안내',
        language: 'JA',
        body: '{{handle}} 様\n明日はご来院の日です。お会いできるのを楽しみにしております。',
        order: 2,
        active: true,
      },
      {
        id: 'thanks',
        title: '게시 감사 인사',
        language: 'KO',
        body: '{{handle}}님, 정성스러운 후기 감사합니다!',
        order: 3,
        active: false,
      },
    ],
  };
}
