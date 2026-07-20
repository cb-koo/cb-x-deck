import { extractJson, pairs, MODEL } from './suggest.ts';
import { callLLM, type AnthropicLike } from './llm.ts';
import type { KwPair } from './suggest.ts';

// 발전 경로: 구조화 리서치 리포트는 이 프롬프트 모듈에 "다중 검색 종합" 프롬프트를 추가하는 식으로 확장
const EXTRACT_PROMPT = (title: string, text: string) => `당신은 일본 뷰티/미용의료 X(트위터) 콘텐츠 기획 리서처입니다.
아래 웹 기사에서 X 검색 컬럼에 쓸 발굴 재료를 추출하세요.

기사 제목: ${title}
기사 본문(발췌):
${text}

추출 대상:
- keywords: 이 기사가 다루는 담론을 X에서 찾을 때 쓸 토픽 검색어. 짧은 단어·실제 일본 X에서 검색될 법한 표현. 4~8개
- hooks: 기사 속 담론에서 뽑을 수 있는 훅 구조어/구문(컨트래리언·意外性·聞き出し型 등 바이럴 오프닝에 쓰일 짧은 구문). 0~4개, 없으면 빈 배열

규칙:
- ja는 짧게(검색어로 그대로 사용 가능해야 함), 문장 금지
- 각 항목에 한국어 번역 ko 병기 (한국 뷰티 업계 통용 표현)
JSON만 출력: {"keywords": [{"ja": "...", "ko": "..."}], "hooks": [{"ja": "...", "ko": "..."}]}`;

export interface ExtractedKeywords { keywords: KwPair[]; hooks: KwPair[] }

export async function extractKeywords(
  article: { title: string; text: string },
  client?: AnthropicLike,
): Promise<ExtractedKeywords> {
  const res = await callLLM('anthropic.research',
    { model: MODEL(), max_tokens: 1000, messages: [{ role: 'user', content: EXTRACT_PROMPT(article.title, article.text) }] }, client);
  const json = extractJson(res);
  if (!json || typeof json !== 'object') return { keywords: [], hooks: [] };
  const o = json as Record<string, unknown>;
  return { keywords: pairs(o.keywords), hooks: pairs(o.hooks) };
}
