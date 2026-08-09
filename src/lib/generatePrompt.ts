import { X_MAX_WEIGHTED } from './xLength.ts';
import type { DraftFormat, ReferenceMode, RefSnapshot } from './draftTypes.ts';

export interface PromptInput {
  client: { name: string; info: string; bannedPhrases: string[] } | null;
  procedures: Array<{ name: string; description: string; effectPhrases: string; bannedPhrases: string[] }>;
  references: RefSnapshot[];
  mode: ReferenceMode;
  direction: string;
  format: DraftFormat;
  constraintsOn: boolean;
  // '다시 쓰기' — 현재 버전 전문 + (선택) 사용자 피드백. 피드백이 없으면 같은 조건 재생성.
  rewrite?: { current: string[]; feedback?: string };
  // 다중 시안 — 2 이상이면 "서로 다른 앵글로 N개" 지시가 붙는다. 1/미지정 = 기존 프롬프트 그대로.
  variantCount?: number;
}

// 편집 가능한 고정 문장 — /prompt(AI 지시문) 페이지가 덮어쓴다. 값이 없거나 빈 문자열이면 기본값.
// 계산값이 치환되는 문장(형식·글자 수·시안 수·금지 표현 헤더)은 편집 대상이 아니다 (스펙).
export const PROMPT_DEFAULTS = {
  system:
    '당신은 일본 미용의료 마케팅의 X(트위터) 카피라이터입니다. ' +
    '인플루언서가 자기 계정에 올릴 자연스러운 일본어 포스트 초안을 작성합니다. ' +
    '광고 문구처럼 읽히지 않는 개인 포스트 톤을 유지하고, 해시태그는 0~2개만 사용합니다.',
  modeForm: '아래 레퍼런스의 형식(문장 구조·길이·줄바꿈·이모지 사용·전개 방식)만 참고하세요. 소재·내용은 가져오지 마세요.',
  modeAngle: '아래 레퍼런스가 소재를 다룬 각도(앵글)만 참고하세요. 문장 형식은 따라 하지 마세요.',
  modeBoth: '아래 레퍼런스의 형식과 앵글을 함께 참고하세요.',
  noCopy: '레퍼런스 문구를 그대로 옮기지 마세요(표절 금지).',
  hook: '첫 단락이 훅입니다 — 빈 줄 전까지의 첫 단락만 읽어도 관심이 생기게 쓰세요.',
} as const;
export type PromptFieldKey = keyof typeof PROMPT_DEFAULTS;
export type PromptOverrides = Partial<Record<PromptFieldKey, string>>;

const pick = (o: PromptOverrides | undefined, k: PromptFieldKey): string => {
  const v = o?.[k]?.trim();
  return v ? v : PROMPT_DEFAULTS[k];
};

// 기존 import 호환용(값 = 기본값). 오버라이드 적용 경로는 draftSystem()을 쓴다.
export const DRAFT_SYSTEM = PROMPT_DEFAULTS.system;
export function draftSystem(overrides?: PromptOverrides): string { return pick(overrides, 'system'); }

const MODE_KEY: Record<Exclude<ReferenceMode, 'off'>, PromptFieldKey> = {
  form: 'modeForm', angle: 'modeAngle', both: 'modeBoth',
};

export function buildUserPrompt(i: PromptInput, overrides?: PromptOverrides): string {
  const blocks: string[] = [];

  // 1) 클라이언트 블록 — 고정 정보를 앞에 (같은 클라 반복 생성 시 프롬프트 캐시 최적화)
  if (i.client) {
    const lines = [`## 클라이언트 정보: ${i.client.name}`, i.client.info];
    for (const p of i.procedures) {
      lines.push(`### 시술: ${p.name}`, p.description);
      if (p.effectPhrases) lines.push(`효과·결과로 쓸 수 있는 표현: ${p.effectPhrases}`);
    }
    blocks.push(lines.filter(Boolean).join('\n'));
  }

  // 2) 레퍼런스 블록 — 메모 = teaching note (예시마다 "무엇이 좋은지"를 앞세우는 방식)
  if (i.mode !== 'off' && i.references.length > 0) {
    const lines = [`## 레퍼런스 (${i.references.length}건)`, pick(overrides, MODE_KEY[i.mode]),
      pick(overrides, 'noCopy')];
    i.references.forEach((r, n) => {
      lines.push(`### 레퍼런스 ${n + 1} (@${r.handle})`);
      for (const m of r.memos) lines.push(`팀 메모(참고 포인트): ${m.text} — ${m.member}`);
      lines.push(r.excerpt);
    });
    blocks.push(lines.join('\n'));
  }

  // 3) 이번 작업 지시 — 가변 정보는 뒤에
  const task = ['## 이번 초안'];
  if (i.direction.trim()) task.push(`방향성: ${i.direction.trim()}`);
  if (i.rewrite) {
    const cur = i.rewrite.current.map((t, n) => `${n + 1}. ${t}`).join('\n---\n');
    task.push('아래는 이 초안의 현재 버전입니다. 처음부터 다시 쓰세요.', cur);
    task.push(i.rewrite.feedback?.trim()
      ? `사용자 피드백(반드시 반영해서 다시 쓰기): ${i.rewrite.feedback.trim()}`
      : '같은 조건으로 새로 쓰되, 현재 버전과 훅·표현이 겹치지 않게 하세요.');
  }
  if ((i.variantCount ?? 1) > 1) {
    task.push(`이번 요청은 시안 ${i.variantCount}개입니다. 서로 다른 앵글·훅으로 ${i.variantCount}개를 만드세요.`,
      '시안끼리 첫 문장(훅)·소재 접근이 겹치면 안 됩니다.');
  }
  task.push(i.format === 'single'
    ? `형식: 단문 포스트 1개. 가중 ${X_MAX_WEIGHTED}자(일본어 약 140자) 이내.`
    : `형식: 스레드 3~5개 포스트. 각 포스트는 가중 ${X_MAX_WEIGHTED}자(일본어 약 140자) 이내. 1번 포스트가 훅.`);
  task.push(pick(overrides, 'hook'));
  if (i.constraintsOn) {
    const banned = [...(i.client?.bannedPhrases ?? []), ...i.procedures.flatMap((p) => p.bannedPhrases)];
    if (banned.length > 0) task.push(`금지 표현(절대 사용 금지): ${banned.join(', ')}`);
  }
  blocks.push(task.join('\n'));

  return blocks.join('\n\n');
}

// 구조화 출력 스키마 — extractJson 정규식 대신 output_config.format으로 형식을 강제
export function draftOutputSchema(): object {
  return {
    type: 'object',
    properties: {
      posts: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
      },
    },
    required: ['posts'],
    additionalProperties: false,
  };
}

// 다중 시안용 — variants[n].posts 구조. 단일 생성은 기존 draftOutputSchema를 그대로 쓴다.
export function variantsOutputSchema(): object {
  return {
    type: 'object',
    properties: {
      variants: {
        type: 'array',
        items: draftOutputSchema(),
      },
    },
    required: ['variants'],
    additionalProperties: false,
  };
}
