/**
 * HTML e-mail templates (table based, inline styles — light theme like real mail clients).
 * Wording is original to OpenSign.
 */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "김민수" → "김민*", "dkko" → "dk**" */
export function maskName(name: string) {
  const n = name.trim();
  if (n.length <= 1) return n;
  if (/^[\x00-\x7f]+$/.test(n)) return n.slice(0, Math.ceil(n.length / 2)) + "*".repeat(Math.floor(n.length / 2));
  return n.slice(0, n.length - 1) + "*";
}

/** "honggildong@example.com" → "ho*********@example.com" */
export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local.slice(0, 2)}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

/** 2026년 10월 28일 12시 51분 */
export function koreanDeadline(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours()}시 ${String(d.getMinutes()).padStart(2, "0")}분`;
}

interface LayoutInput {
  heading: string;
  lead: string[];
  rows?: { label: string; value: string[] }[];
  cta?: { label: string; href: string };
  notices?: boolean;
}

export function emailLayout({ heading, lead, rows = [], cta, notices = false }: LayoutInput) {
  const rowsHtml = rows
    .map(
      (r) => `<tr>
  <td style="padding:14px 0;border-top:1px solid #e0e0e0;width:140px;vertical-align:top;font-size:15px;font-weight:700;color:#292929">${esc(r.label)}</td>
  <td style="padding:14px 0;border-top:1px solid #e0e0e0;font-size:15px;color:#292929;line-height:1.6">${r.value.map(esc).join("<br>")}</td>
</tr>`,
    )
    .join("");

  const ctaHtml = cta
    ? `<tr><td style="padding:32px 0 8px"><a href="${esc(cta.href)}" style="display:block;background:#ffcb4c;color:#212121;text-decoration:none;text-align:center;font-size:17px;font-weight:700;line-height:56px;border-radius:6px">${esc(cta.label)}</a></td></tr>`
    : "";

  const noticeHtml = notices
    ? `<tr><td style="padding:28px 0 0;font-size:13px;color:#757575;line-height:1.7">
  <p style="margin:0 0 4px;font-weight:700;color:#474747">이메일과 링크를 다른 사람에게 전달하지 마세요.</p>
  <p style="margin:0 0 16px">이 메일의 링크로 누구나 문서를 열고 서명할 수 있습니다.</p>
  <p style="margin:0 0 4px;font-weight:700;color:#474747">이 메일 주소로 진행 상황을 알려 드립니다.</p>
  <p style="margin:0 0 16px">서명 완료 문서도 이 주소로 발송되니 메일을 삭제하지 마세요.</p>
  <p style="margin:0 0 4px;font-weight:700;color:#474747">서명 기록은 안전하게 보관됩니다.</p>
  <p style="margin:0">서명 시각과 접속 정보 등 진행 이력은 감사 로그에 남아 서명 사실을 증명합니다.</p>
</td></tr>`
    : "";

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0"><tr><td align="center">
<table role="presentation" width="660" cellpadding="0" cellspacing="0" style="max-width:660px;width:100%;background:#ffffff;border-top:4px solid #28303c">
  <tr><td style="padding:28px 48px 22px;border-bottom:1px solid #e0e0e0">
    <div style="font-size:13px;color:#474747;margin-bottom:8px">사내 전자서명 서비스</div>
    <div style="font-size:24px;font-weight:500;letter-spacing:-0.5px;color:#191919">Open<span style="font-weight:800;background:#ffcb4c;padding:0 5px;border-radius:5px">Sign</span></div>
  </td></tr>
  <tr><td style="padding:40px 48px 44px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="font-size:28px;font-weight:700;color:#212121;padding-bottom:24px">${esc(heading)}</td></tr>
      <tr><td style="font-size:15px;color:#292929;line-height:1.7;padding-bottom:32px">${lead.map(esc).join("<br>")}</td></tr>
      ${rowsHtml ? `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #e0e0e0">${rowsHtml}</table></td></tr>` : ""}
      ${ctaHtml}
      ${noticeHtml}
    </table>
  </td></tr>
  <tr><td style="padding:22px 48px 30px;background:#f8f8f8;font-size:12px;color:#949494;line-height:1.7">
    본 메일은 발신 전용입니다. 문의는 사내 관리자에게 연락해 주세요.<br>
    © 2026 OpenSign. All rights reserved.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/* --------------------------------------------------------------- templates */

export function signRequestEmail(p: {
  title: string;
  requesterName: string;
  requesterEmail: string;
  signerName: string;
  signers: { name: string; email: string | null }[];
  expiresAt: string | null;
  link: string;
  message?: string | null;
  view?: boolean;
}) {
  const verb = p.view ? "열람" : "서명";
  const rows = [
    { label: "문서 제목", value: [p.title] },
    { label: `${verb} 요청자`, value: [`${p.requesterName} (${p.requesterEmail})`] },
    { label: p.view ? "열람자" : "서명자", value: p.signers.map((s) => `${maskName(s.name)}${s.email ? ` (${maskEmail(s.email)})` : ""}`) },
  ];
  if (p.expiresAt) rows.push({ label: `${verb} 기한`, value: [koreanDeadline(p.expiresAt)] });
  if (p.message) rows.push({ label: "남긴 말", value: [p.message] });
  return {
    subject: `[${verb}요청] '${maskName(p.signerName)}'님이 '${p.title}'에 ${verb}할 차례입니다.`,
    html: emailLayout({
      heading: `${verb}할 차례 입니다.`,
      lead: [`${verb} 정보를 확인해 주세요.`, `아래 버튼을 누르면 ${verb}할 수 있는 페이지로 이동합니다.`],
      rows,
      cta: { label: p.view ? "내용 확인하기" : "내용 확인하고 서명하기", href: p.link },
      notices: true,
    }),
  };
}

export function completedEmail(p: {
  title: string;
  requesterName: string;
  signers: { name: string; email: string | null }[];
  completedAt: string;
  link: string;
  /** documents.id */
  documentId?: string;
  /** SHA-256 hex of the completed PDF (원본 검증키) */
  hash?: string | null;
}) {
  const rows = [
    { label: "문서 제목", value: [p.title] },
    { label: "서명 요청자", value: [p.requesterName] },
    { label: "서명자", value: p.signers.map((s) => `${maskName(s.name)}${s.email ? ` (${maskEmail(s.email)})` : ""}`) },
    { label: "완료 일시", value: [koreanDeadline(p.completedAt)] },
  ];
  if (p.documentId) rows.push({ label: "문서 ID", value: [p.documentId] });
  if (p.hash) rows.push({ label: "원본 검증키", value: [p.hash, "※ 원본 검증키로 완료 문서의 위·변조 여부를 확인할 수 있습니다."] });
  return {
    subject: `[서명완료] '${p.title}'문서에 서명이 완료되었습니다.`,
    html: emailLayout({
      heading: "서명이 완료되었습니다.",
      lead: ["모든 참여자의 서명이 완료되었습니다.", "완료 문서와 감사 추적 인증서를 첨부했으며, 아래 버튼에서도 확인할 수 있습니다."],
      rows,
      cta: { label: "완료된 문서 확인하기", href: p.link },
      notices: true,
    }),
  };
}

export function rejectedEmail(p: { title: string; signerName: string; reason: string; link: string }) {
  return {
    subject: `[서명거절] '${p.signerName}'님이 '${p.title}' 서명을 거절했습니다.`,
    html: emailLayout({
      heading: "서명이 거절되었습니다.",
      lead: [`${p.signerName}님이 문서 서명을 거절했습니다.`, "거절 사유를 확인하고 필요하면 문서를 수정해 다시 요청하세요."],
      rows: [
        { label: "문서 제목", value: [p.title] },
        { label: "거절한 사람", value: [p.signerName] },
        { label: "거절 사유", value: [p.reason || "-"] },
      ],
      cta: { label: "문서함에서 확인하기", href: p.link },
    }),
  };
}

export function cancelledEmail(p: { title: string; requesterName: string; reason?: string | null }) {
  return {
    subject: `[요청취소] '${p.title}' 서명 요청이 취소되었습니다.`,
    html: emailLayout({
      heading: "서명 요청이 취소되었습니다.",
      lead: [`${p.requesterName}님이 서명 요청을 취소했습니다.`, "이전에 받은 서명 링크는 더 이상 사용할 수 없습니다."],
      rows: [
        { label: "문서 제목", value: [p.title] },
        { label: "취소 사유", value: [p.reason || "-"] },
      ],
    }),
  };
}

export function reminderEmail(p: { title: string; requesterName: string; signerName: string; expiresAt: string | null; link: string }) {
  return {
    subject: `[리마인드] '${p.title}' 문서 서명을 기다리고 있습니다.`,
    html: emailLayout({
      heading: "서명을 기다리고 있습니다.",
      lead: [`${p.requesterName}님이 ${p.signerName}님의 서명을 기다리고 있습니다.`, "아래 버튼을 눌러 서명을 진행해 주세요."],
      rows: [
        { label: "문서 제목", value: [p.title] },
        ...(p.expiresAt ? [{ label: "서명 기한", value: [koreanDeadline(p.expiresAt)] }] : []),
      ],
      cta: { label: "내용 확인하고 서명하기", href: p.link },
      notices: true,
    }),
  };
}
