import { callLLM, type AnthropicLike } from './llm.ts';
import { extractJson, MODEL } from './suggest.ts';
import { GLOSSARY } from './translate.ts';

// 생성 원고(일본어)를 검토용 한국어로 — 트윗 번역(translate.ts)과 같은 용어집·톤 규칙.
// 초안 1건 = 포스트 1~5개, 각 가중 280자 이내라 한 호출로도 출력 잘림 위험이 없다.
// 트윗 번역과 달리 캐시가 없다: 초안은 짧고(호출당 1원 미만) 편집되면 원문 자체가 바뀐다.
export async function translateDraftPosts(texts: string[], client?: AnthropicLike): Promise<string[] | null> {
  if (texts.length === 0) return [];
  const blocks = texts.map((t, i) => `### 포스트 ${i + 1}\n${t}`);
  const prompt = `당신은 일본 뷰티/미용의료 X(트위터) 원고를 한국 콘텐츠 기획팀에 전달하는 번역가입니다.
아래 일본어 포스트들을 자연스러운 한국어로 번역하세요.

규칙:
- @멘션, #해시태그, URL, 숫자, 이모지는 원문 그대로 보존(번역·삭제 금지)
- **원문의 줄바꿈(개행) 구조를 그대로 유지**하세요. 원문이 여러 줄이면 번역도 같은 줄 구성으로.
- 직역 금지 — 한국 뷰티 업계에서 통용되는 표현으로. 트윗 특유의 구어 톤 유지
- 아래 용어집을 우선 적용:
${GLOSSARY.map((g) => `  ${g}`).join('\n')}

[포스트 목록 — 각 포스트는 "### 포스트 N" 블록]
${blocks.join('\n\n')}

번호(### 포스트 N의 N)를 키로 하는 JSON만 출력: {"1":"...","2":"..."}
문자열 안의 줄바꿈은 \\n으로 이스케이프하세요.`;

  const res = await callLLM('anthropic.draftTranslate', {
    model: MODEL(),
    max_tokens: Math.min(8000, texts.length * 2000), // 포스트당 가중 280자 — 번역+JSON에 충분
    messages: [{ role: 'user', content: prompt }],
  }, client);

  const j = extractJson(res) as Record<string, unknown> | null;
  if (!j) return null;
  const out: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    const v = j[String(i + 1)];
    // 전부 갖춰져야 반환 — 스레드 일부만 번역된 화면은 오독을 부르고, 초안은 짧아 재시도 비용이 없다
    if (typeof v !== 'string' || !v.trim()) return null;
    out.push(v.trim());
  }
  return out;
}
