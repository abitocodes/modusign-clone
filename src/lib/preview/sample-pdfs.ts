/**
 * Sample PDFs of the preview seed (pdf-lib + @pdf-lib/fontkit + public/fonts/Pretendard-Regular.ttf).
 * Original, fictional wording; every document is marked "(샘플)". The signature block positions
 * are exported so the seed can place fields exactly on the drawn boxes (PDF points from the page's
 * top-left, like `fields.x/y`).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type SampleKind = "labor" | "nda" | "supply" | "privacy" | "service" | "mou" | "policy" | "purchase" | "minutes";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Field boxes of one signing party (page 1). */
export interface PartySlot {
  label: string;
  name: Rect;
  date: Rect;
  signature: Rect;
  /** consent checkbox (개인정보 동의서) */
  checkbox?: Rect;
}

export interface SamplePdf {
  kind: SampleKind;
  title: string;
  bytes: Uint8Array;
  pageCount: number;
  pageSizes: { w: number; h: number }[];
  slots: PartySlot[];
}

const W = 595.28;
const H = 841.89;
const M = 60;
const INK = rgb(0.13, 0.13, 0.15);
const MUTED = rgb(0.45, 0.45, 0.5);
const LINE = rgb(0.75, 0.75, 0.78);
const ACCENT = rgb(0.52, 0.43, 0);

interface Spec {
  title: string;
  intro: string;
  clauses: [string, string][];
  parties: string[];
  consent?: string;
  /** free-form block instead of the signature block (품의서 / 회의록 / 안내문) */
  extra?: "approvalBox" | "none";
}

const SPECS: Record<SampleKind, Spec> = {
  labor: {
    title: "근로계약서 (샘플)",
    intro: "사업주(이하 \"갑\")와 근로자(이하 \"을\")는 다음과 같이 근로계약을 체결하고 성실히 이행할 것을 약정한다.",
    clauses: [
      ["제1조 (근무 장소 및 업무)", "을은 갑이 지정한 사업장에서 갑이 정한 업무를 수행한다. 업무 내용은 상호 협의하여 조정할 수 있다."],
      ["제2조 (계약 기간)", "계약 기간은 근로 개시일부터 1년으로 하며, 기간 만료 1개월 전까지 별도 의사표시가 없으면 같은 조건으로 연장된다."],
      ["제3조 (근로 시간 및 휴게)", "근로 시간은 1일 8시간, 1주 40시간을 원칙으로 하며, 휴게 시간은 근로 시간 도중에 1시간을 부여한다."],
      ["제4조 (임금)", "임금은 매월 정해진 지급일에 을의 명의 계좌로 지급하며, 세부 금액은 별도의 임금 명세서에 따른다."],
      ["제5조 (휴일 및 휴가)", "주휴일과 연차 유급휴가는 관련 법령 및 갑의 취업규칙에서 정하는 바에 따른다."],
      ["제6조 (기타)", "이 계약서에 정하지 않은 사항은 관계 법령과 갑의 취업규칙에 따른다. 이 문서는 미리보기용 예시이다."],
    ],
    parties: ["사업주 (갑)", "근로자 (을)"],
  },
  nda: {
    title: "비밀유지 서약서 (샘플)",
    intro: "본인은 회사의 업무를 수행하면서 알게 된 영업비밀 및 기밀 정보에 관하여 다음 사항을 준수할 것을 서약합니다.",
    clauses: [
      ["1. 비밀 정보의 범위", "기술 자료, 고객 정보, 거래 조건, 내부 문서 등 회사가 비밀로 관리하는 일체의 정보를 말합니다."],
      ["2. 비밀 유지 의무", "재직 중은 물론 퇴직 후에도 회사의 사전 서면 동의 없이 비밀 정보를 제3자에게 누설하거나 업무 외의 목적으로 사용하지 않습니다."],
      ["3. 자료의 반환", "퇴직하거나 회사가 요청하는 경우 보유하고 있는 비밀 정보와 그 사본을 지체 없이 반환하거나 폐기합니다."],
      ["4. 위반 시 책임", "본 서약을 위반하여 회사에 손해가 발생한 경우 관련 법령에 따라 책임을 부담합니다."],
      ["5. 기타", "이 문서는 미리보기 모드에서 사용하는 예시 문서로 실제 효력이 없습니다."],
    ],
    parties: ["서약자"],
  },
  supply: {
    title: "물품 공급 계약서 (샘플)",
    intro: "공급자(이하 \"갑\")와 구매자(이하 \"을\")는 물품의 공급에 관하여 다음과 같이 계약을 체결한다.",
    clauses: [
      ["제1조 (목적)", "이 계약은 갑이 을에게 별첨 명세서에 기재된 물품을 공급하고 을이 그 대금을 지급하는 데 필요한 사항을 정한다."],
      ["제2조 (납품)", "갑은 을이 지정한 장소에 약정한 납기까지 물품을 납품하며, 운송 중 발생한 손해는 갑이 부담한다."],
      ["제3조 (검수)", "을은 물품을 인도받은 날부터 7일 이내에 검수를 마치고, 하자가 있는 경우 갑에게 교환 또는 보완을 요구할 수 있다."],
      ["제4조 (대금 지급)", "을은 검수 완료 후 갑이 발행한 세금계산서를 받은 날이 속한 달의 다음 달 말일까지 대금을 지급한다."],
      ["제5조 (계약 기간)", "이 계약의 유효 기간은 체결일부터 1년으로 한다. 이 문서는 미리보기용 예시이다."],
    ],
    parties: ["공급자 (갑)", "구매자 (을)"],
  },
  privacy: {
    title: "개인정보 수집·이용 동의서 (샘플)",
    intro: "회사는 아래와 같이 개인정보를 수집·이용하고자 합니다. 내용을 자세히 읽으신 후 동의 여부를 결정하여 주십시오.",
    clauses: [
      ["1. 수집·이용 목적", "인사 관리, 급여 지급, 복리후생 제공 및 법령상 의무 이행"],
      ["2. 수집 항목", "성명, 연락처, 이메일 주소, 주소, 계좌 정보 등 업무 수행에 필요한 최소한의 정보"],
      ["3. 보유 및 이용 기간", "수집·이용 목적이 달성된 후 지체 없이 파기하며, 관계 법령에서 정한 기간 동안은 보관할 수 있습니다."],
      ["4. 동의를 거부할 권리", "귀하는 동의를 거부할 권리가 있으며, 동의를 거부하는 경우 일부 서비스 제공이 제한될 수 있습니다."],
    ],
    parties: ["동의자"],
    consent: "위 내용을 확인하였으며 개인정보 수집·이용에 동의합니다.",
  },
  service: {
    title: "용역 계약서 (샘플)",
    intro: "발주자(이하 \"갑\")와 수행자(이하 \"을\")는 다음 용역의 수행에 관하여 상호 신의에 따라 계약을 체결한다.",
    clauses: [
      ["제1조 (용역의 내용)", "을은 갑이 제시한 과업 지시서에 따라 용역을 수행하고 그 결과물을 갑에게 제출한다."],
      ["제2조 (수행 기간)", "용역 수행 기간은 계약 체결일부터 3개월로 하며, 갑과 을의 합의로 변경할 수 있다."],
      ["제3조 (대가)", "용역 대가는 별도 견적서에 따르며, 결과물 검수 완료 후 30일 이내에 지급한다."],
      ["제4조 (권리의 귀속)", "용역 결과물에 관한 권리는 대가 지급이 완료된 때에 갑에게 귀속한다."],
      ["제5조 (기타)", "이 계약에 정하지 않은 사항은 상관례에 따른다. 이 문서는 미리보기용 예시이다."],
    ],
    parties: ["발주자 (갑)", "수행자 (을)"],
  },
  mou: {
    title: "업무 협약서 (샘플)",
    intro: "협약 당사자(이하 \"갑\"과 \"을\")는 상호 발전과 협력을 위하여 다음과 같이 업무 협약을 체결한다.",
    clauses: [
      ["제1조 (목적)", "이 협약은 갑과 을이 보유한 역량을 활용하여 공동 사업을 추진하는 데 필요한 사항을 정함을 목적으로 한다."],
      ["제2조 (협력 분야)", "공동 프로젝트 기획, 기술 교류, 인력 교류 및 홍보 협력 등 양측이 합의한 분야"],
      ["제3조 (실무 협의체)", "협약의 원활한 이행을 위하여 양측 담당자로 구성된 실무 협의체를 운영한다."],
      ["제4조 (유효 기간)", "이 협약은 체결일부터 2년간 유효하다. 이 문서는 미리보기용 예시이다."],
    ],
    parties: ["기관 A (갑)", "기관 B (을)"],
  },
  policy: {
    title: "사내 정보보안 정책 안내 (샘플)",
    intro: "모든 임직원은 회사 자산과 고객 정보를 보호하기 위하여 아래의 정보보안 정책을 숙지하여 주시기 바랍니다.",
    clauses: [
      ["1. 계정 관리", "업무용 계정의 비밀번호는 타인과 공유하지 않으며, 정기적으로 변경합니다."],
      ["2. 자료 반출", "업무 자료를 외부 저장 매체나 개인 메일로 반출하려면 사전에 승인을 받아야 합니다."],
      ["3. 화면 잠금", "자리를 비울 때에는 반드시 화면 잠금을 설정합니다."],
      ["4. 보안 사고 신고", "의심스러운 메일이나 보안 사고를 발견하면 즉시 정보보안 담당자에게 알립니다."],
      ["5. 안내", "이 문서는 열람 요청 예시를 위한 샘플이며 실제 정책이 아닙니다."],
    ],
    parties: [],
    extra: "none",
  },
  purchase: {
    title: "구매 품의서 (샘플)",
    intro: "업무용 장비 구매를 위하여 아래와 같이 품의하오니 검토 후 승인하여 주시기 바랍니다.",
    clauses: [
      ["1. 구매 목적", "신규 입사자 업무 환경 구성 및 노후 장비 교체"],
      ["2. 구매 내역", "노트북 3대, 모니터 3대, 무선 키보드·마우스 세트 3개"],
      ["3. 예상 금액", "총 6,450,000원 (부가세 포함, 견적 기준)"],
      ["4. 납품 일정", "승인 후 2주 이내 납품 예정"],
      ["5. 비고", "이 문서는 내부결재 예시를 위한 샘플입니다."],
    ],
    parties: [],
    extra: "approvalBox",
  },
  minutes: {
    title: "주간 회의록 (샘플)",
    intro: "일시: 매주 월요일 오전 10시 · 장소: 3층 회의실 · 참석: 경영지원팀, 영업팀, 법무팀",
    clauses: [
      ["1. 지난 주 진행 사항", "전자서명 도입 일정 공유, 계약서 서식 정비 현황 점검"],
      ["2. 이번 주 계획", "근로계약서·비밀유지 서약서 템플릿 확정, 대량전송 테스트"],
      ["3. 논의 사항", "외부 거래처 서명 요청 시 안내 문구 통일, 서명 기한 기본값 14일 유지"],
      ["4. 결정 사항", "다음 회의 전까지 각 팀별 서식 검토 의견 회신"],
    ],
    parties: [],
    extra: "none",
  },
};

/** Signature-block geometry (shared by the drawing and the seed's fields). */
function slotsFor(spec: Spec): PartySlot[] {
  const top = 642;
  const columns = spec.parties.length === 1 ? [W / 2 - 115] : [M, W - M - 230];
  return spec.parties.map((label, i) => {
    const x0 = columns[i];
    const slot: PartySlot = {
      label,
      name: { x: x0 + 58, y: top + 26, width: 104, height: 16 },
      date: { x: x0 + 58, y: top + 56, width: 104, height: 16 },
      signature: { x: x0 + 170, y: top + 18, width: 50, height: 50 },
    };
    if (spec.consent) slot.checkbox = { x: M - 1, y: 584 - 1, width: 14, height: 14 };
    return slot;
  });
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const ch of Array.from(text)) {
    const next = line + ch;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      // break at the last space when possible
      const sp = line.lastIndexOf(" ");
      if (sp > line.length * 0.6) {
        out.push(line.slice(0, sp));
        line = line.slice(sp + 1) + ch;
      } else {
        out.push(line);
        line = ch === " " ? "" : ch;
      }
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** text with its baseline `top` points below the page top */
function text(page: PDFPage, font: PDFFont, s: string, x: number, top: number, size: number, color = INK, heavy = false) {
  page.drawText(s, { x, y: H - top, size, font, color });
  if (heavy) page.drawText(s, { x: x + 0.35, y: H - top, size, font, color });
}

function rectOutline(page: PDFPage, r: Rect, color = LINE, dash?: number[]) {
  page.drawRectangle({ x: r.x, y: H - r.y - r.height, width: r.width, height: r.height, borderColor: color, borderWidth: 0.8, borderDashArray: dash });
}

function draw(page: PDFPage, font: PDFFont, spec: Spec) {
  const centered = (s: string, top: number, size: number, color = INK, heavy = false) =>
    text(page, font, s, (W - font.widthOfTextAtSize(s, size)) / 2, top, size, color, heavy);

  // header
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: ACCENT });
  centered(spec.title, 92, 22, INK, true);
  centered("이 문서는 미리보기용 샘플입니다. 실제 효력이 없습니다.", 116, 9, MUTED);
  page.drawLine({ start: { x: M, y: H - 130 }, end: { x: W - M, y: H - 130 }, thickness: 0.8, color: LINE });

  let y = 158;
  for (const l of wrap(font, spec.intro, 10.5, W - 2 * M)) {
    text(page, font, l, M, y, 10.5);
    y += 17;
  }
  y += 10;
  for (const [heading, body] of spec.clauses) {
    text(page, font, heading, M, y, 11, INK, true);
    y += 18;
    for (const l of wrap(font, body, 10, W - 2 * M - 10)) {
      text(page, font, l, M + 10, y, 10, rgb(0.25, 0.25, 0.28));
      y += 16;
    }
    y += 9;
  }

  if (spec.consent) {
    rectOutline(page, { x: M, y: 584, width: 12, height: 12 }, INK);
    text(page, font, spec.consent, M + 20, 594, 10.5);
  }

  if (spec.extra === "approvalBox") {
    const labels = ["기안", "검토", "승인"];
    const bx = W - M - 3 * 70;
    labels.forEach((l, i) => {
      const x = bx + i * 70;
      page.drawRectangle({ x, y: H - 640 - 22, width: 70, height: 22, borderColor: LINE, borderWidth: 0.8 });
      page.drawRectangle({ x, y: H - 640 - 22 - 56, width: 70, height: 56, borderColor: LINE, borderWidth: 0.8 });
      text(page, font, l, x + 35 - font.widthOfTextAtSize(l, 10) / 2, 656, 10);
    });
    text(page, font, "기안부서: 경영지원팀 · 문서번호: 샘플-001", M, 760, 9.5, MUTED);
  }

  const slots = slotsFor(spec);
  if (slots.length) {
    const blockTop = 620;
    page.drawRectangle({ x: M, y: H - 790, width: W - 2 * M, height: 790 - blockTop, borderColor: LINE, borderWidth: 0.8 });
    text(page, font, "위 내용을 확인하고 아래와 같이 서명합니다.", M + 12, blockTop + 16, 9.5, MUTED);
    for (const s of slots) {
      const x0 = s.name.x - 58;
      text(page, font, s.label, x0 + 10, s.signature.y - 6, 10.5, INK, true);
      text(page, font, "성명", x0 + 10, s.name.y + 12, 10);
      page.drawLine({ start: { x: s.name.x, y: H - s.name.y - s.name.height - 1 }, end: { x: s.name.x + s.name.width, y: H - s.name.y - s.name.height - 1 }, thickness: 0.6, color: LINE });
      text(page, font, "서명일", x0 + 10, s.date.y + 12, 10);
      page.drawLine({ start: { x: s.date.x, y: H - s.date.y - s.date.height - 1 }, end: { x: s.date.x + s.date.width, y: H - s.date.y - s.date.height - 1 }, thickness: 0.6, color: LINE });
      rectOutline(page, s.signature, LINE, [3, 2]);
      text(page, font, "(서명)", s.signature.x + s.signature.width / 2 - font.widthOfTextAtSize("(서명)", 8) / 2, s.signature.y + s.signature.height / 2 + 3, 8, LINE);
    }
  }

  // footer
  page.drawLine({ start: { x: M, y: 46 }, end: { x: W - M, y: 46 }, thickness: 0.5, color: LINE });
  text(page, font, "OpenSign · 미리보기 샘플 문서", M, H - 32, 8, MUTED);
  text(page, font, "1 / 1", W - M - font.widthOfTextAtSize("1 / 1", 8), H - 32, 8, MUTED);
}

async function readFont(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "fonts", "Pretendard-Regular.ttf")));
}

export const SAMPLE_KINDS = Object.keys(SPECS) as SampleKind[];

/** bump when draw() / slotsFor() change (the wording is part of the cache key anyway) */
const LAYOUT_VERSION = 1;

/** On-disk cache of the generated files (inside the preview build dir, git-ignored). */
function cacheDir() {
  const key = createHash("sha256").update(`${LAYOUT_VERSION}\n${JSON.stringify(SPECS)}`).digest("hex").slice(0, 16);
  return path.join(/*turbopackIgnore: true*/ process.cwd(), process.env.NEXT_DIST_DIR || ".next-preview", "cache", "preview-samples", key);
}

async function readCache(): Promise<Map<SampleKind, Uint8Array> | null> {
  try {
    const dir = cacheDir();
    const out = new Map<SampleKind, Uint8Array>();
    for (const kind of SAMPLE_KINDS) out.set(kind, new Uint8Array(await readFile(path.join(dir, `${kind}.pdf`))));
    return out;
  } catch {
    return null;
  }
}

async function writeCache(files: Map<SampleKind, Uint8Array>) {
  try {
    const dir = cacheDir();
    await mkdir(dir, { recursive: true });
    for (const [kind, bytes] of files) await writeFile(path.join(dir, `${kind}.pdf`), bytes);
  } catch {
    // read-only checkout etc.: generate again next time
  }
}

/**
 * Every sample PDF. Generation takes ≈0.5 s per file (the font is embedded whole — subsetting
 * drops Hangul glyphs), so the files are cached on disk between server starts.
 */
export async function buildSamplePdfs(): Promise<Record<SampleKind, SamplePdf>> {
  let files = await readCache();
  if (!files) {
    files = new Map();
    const font = await readFont();
    for (const kind of SAMPLE_KINDS) {
      const spec = SPECS[kind];
      const doc = await PDFDocument.create({ updateMetadata: false });
      doc.registerFontkit(fontkit);
      doc.setTitle(spec.title);
      doc.setProducer("opensign preview");
      const f = await doc.embedFont(font, { subset: false });
      draw(doc.addPage([W, H]), f, spec);
      files.set(kind, await doc.save());
    }
    await writeCache(files);
  }
  const out = {} as Record<SampleKind, SamplePdf>;
  for (const kind of SAMPLE_KINDS) {
    const spec = SPECS[kind];
    out[kind] = { kind, title: spec.title, bytes: files.get(kind) as Uint8Array, pageCount: 1, pageSizes: [{ w: W, h: H }], slots: slotsFor(spec) };
  }
  return out;
}
