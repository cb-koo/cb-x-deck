// 문서 붙여넣기를 듣는 첨부 칸(TaskProofField·PaymentQrField)의 공용 판정 — 모달이 떠 있으면 맨 위 모달 안의
// 칸만 받는다. 둘 다 document의 paste를 들어서, RT 패널 위에 결제 수단 등록(aria-modal)이 뜬 채 QR을 붙이면
// 한 이미지가 QR과 RT 증빙 양쪽으로 올라가던 문제(posted-inline 리뷰 I1). 작업 패널 자체는 role="dialog"지만
// aria-modal이 아니라 여기 걸리지 않는다 — 패널만 열려 있을 때의 붙여넣기는 그대로 증빙 칸이 받는다.
// 맨 위 = 문서 순서상 마지막(포털·뒤에 그려진 레이어가 뒤에 붙는다).
export function pasteBlockedByModal(field: HTMLElement | null): boolean {
  const modals = document.querySelectorAll('[aria-modal="true"]');
  if (modals.length === 0) return false;
  const top = modals[modals.length - 1];
  return !field || !top.contains(field);
}
