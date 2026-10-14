export const AUDIT_PAGE_SIZE = 20;

/** document_events.type values with Korean labels (filter options of 감사 로그). */
export const AUDIT_EVENT_TYPES: { value: string; label: string }[] = [
  { value: "created", label: "서명 요청 시작" },
  { value: "sent", label: "문서 전송" },
  { value: "viewed", label: "문서 열람" },
  { value: "signed", label: "서명" },
  { value: "rejected", label: "서명 거절" },
  { value: "completed", label: "서명 완료" },
  { value: "cancelled", label: "요청 취소" },
  { value: "reminded", label: "리마인드" },
  { value: "modified", label: "문서 수정" },
];
