// 원고 본문에 ⌘V로 이미지 붙이기(koo 09-29) — 클립보드에서 이미지 파일만 골라낸다(순수, 브라우저 API는 모양만 받는다).
// 스크린샷(⌘⇧⌃4)·웹의 '이미지 복사'·파인더에서 파일 복사 모두 files(또는 items의 file)로 온다.
// 이미지가 하나라도 있으면 호출부가 기본 붙여넣기(글자)를 막고 이미지로 붙인다. 없으면 빈 배열 — 글자는 그대로 흘려보낸다.
// 형식·크기·장수 검사는 여기서 하지 않는다 — 파일로 고를 때와 같은 selectDraftImages가 한 곳에서 한다(같은 거절 문구).
type ClipItem = { kind: string; type: string; getAsFile(): File | null };
type ClipLike = { files?: ArrayLike<File> | null; items?: ArrayLike<ClipItem> | null } | null | undefined;

export function imageFilesFromClipboard(data: ClipLike): File[] {
  if (!data) return [];
  const fromFiles = Array.from(data.files ?? []).filter((f) => f.type.startsWith('image/'));
  if (fromFiles.length > 0) return fromFiles;
  // 일부 브라우저·앱은 files를 비우고 items에만 싣는다
  const out: File[] = [];
  for (const it of Array.from(data.items ?? [])) {
    if (it.kind !== 'file' || !it.type.startsWith('image/')) continue;
    const f = it.getAsFile();
    if (f) out.push(f);
  }
  return out;
}
