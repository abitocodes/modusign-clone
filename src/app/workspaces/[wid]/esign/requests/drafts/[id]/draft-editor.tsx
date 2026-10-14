"use client";

import {
  Bold,
  FileDown,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Pilcrow,
  Redo2,
  SeparatorHorizontal,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Underline,
  Undo2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { readPdfInfo } from "@/components/pdf/pdf";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { MAX_PDF_BYTES, paths } from "@/lib/storage";
import { cn, fmtShort } from "@/lib/utils";

import { loadFontBytes, newId, uploadPdf } from "../../_edit-kit/client";
import {
  BusyOverlay,
  EditorFrame,
  EditorHeader,
  HeaderButton,
  HeaderPrimaryButton,
  ToolButton,
  ToolDivider,
} from "../../_edit-kit/editor-frame";
import { useHydrated } from "../../_edit-kit/list-ui";
import { requestSignFromDraft, saveDraft } from "../actions";
import { draftHasContent } from "../sanitize";
import { parseDraftDom, renderDraftPdf } from "./draft-pdf";

const AUTOSAVE_MS = 2500;

type SaveState = "saved" | "dirty" | "saving" | "error";

interface ActiveFormats {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  ul: boolean;
  ol: boolean;
  block: "p" | "h1" | "h2";
  align: "left" | "center" | "right";
}
const NO_FORMATS: ActiveFormats = { bold: false, italic: false, underline: false, ul: false, ol: false, block: "p", align: "left" };

/**
 * A4 sheet styles (1px = 0.75pt in the generated PDF; see BLOCK_STYLES in draft-pdf.ts).
 * Content colours are those of a printed page, independent of the app theme.
 */
const SHEET_CSS = cn(
  "relative min-h-[1123px] w-[794px] bg-page px-[75.6px] py-[75.6px] text-[14px] leading-[1.6] text-neutral-900 shadow-card outline-none",
  "[overflow-wrap:anywhere] [word-break:keep-all] caret-neutral-900",
  "[&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-[26px] [&_h1]:font-bold [&_h1]:leading-[1.35]",
  "[&_h2]:mb-1.5 [&_h2]:mt-2.5 [&_h2]:text-[20px] [&_h2]:font-bold [&_h2]:leading-[1.4]",
  "[&>*:first-child]:mt-0 [&_strong]:font-bold [&_b]:font-bold [&_em]:italic [&_i]:italic [&_u]:underline",
  "[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul_ul]:list-[circle] [&_ul_ul_ul]:list-[square]",
  "[&_hr]:my-3 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-neutral-300",
);

export function DraftEditor({
  wid,
  draft,
  canEdit,
}: {
  wid: string;
  draft: { id: string; title: string; content: string; updatedAt: string };
  canEdit: boolean;
}) {
  const router = useRouter();
  const listHref = `/workspaces/${wid}/esign/requests/drafts`;
  const editorRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // edit counter / last counter value that reached the server / save request in flight
  const versionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const inflightRef = useRef<Promise<boolean> | null>(null);
  const hydrated = useHydrated();

  const [title, setTitle] = useState(draft.title === "제목 없는 서식" ? "" : draft.title);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState(draft.updatedAt);
  const [isEmpty, setIsEmpty] = useState(() => !draftHasContent(draft.content));
  const [formats, setFormats] = useState<ActiveFormats>(NO_FORMATS);
  const [busy, setBusy] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [exitFailed, setExitFailed] = useState(false);
  const titleRef = useRef(title);
  // the editor is uncontrolled: later server re-renders (after a save) must not reset it
  const [initialContent] = useState(draft.content);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = initialContent || "<p><br></p>";
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
      document.execCommand("styleWithCSS", false, "false");
    } catch {
      /* not supported */
    }
  }, [initialContent]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  /* ---------------------------------------------------------------- save */
  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const runSave = async (manual: boolean): Promise<boolean> => {
    const el = editorRef.current;
    if (!el) return false;
    const version = versionRef.current;
    setSaveState("saving");
    const res = await saveDraft({ wid, id: draft.id, title: titleRef.current, content: el.innerHTML, revalidate: manual });
    if (!res.ok) {
      setSaveState("error");
      if (manual) toast.error(res.error);
      return false;
    }
    savedVersionRef.current = Math.max(savedVersionRef.current, version);
    setSavedAt(res.updatedAt);
    if (versionRef.current === version) setSaveState("saved");
    else {
      setSaveState("dirty");
      schedule();
    }
    return true;
  };

  /** Saves now. When a save is already running it waits for it and saves again only if there were edits since. */
  const save = async (manual: boolean): Promise<boolean> => {
    if (!canEdit) return true;
    while (inflightRef.current) {
      const ok = await inflightRef.current;
      if (ok && savedVersionRef.current === versionRef.current) {
        clearTimer();
        return true;
      }
    }
    clearTimer();
    const p = runSave(manual);
    inflightRef.current = p;
    try {
      return await p;
    } finally {
      if (inflightRef.current === p) inflightRef.current = null;
    }
  };

  const schedule = () => {
    clearTimer();
    timerRef.current = setTimeout(() => void save(false), AUTOSAVE_MS);
  };

  const markDirty = () => {
    if (!canEdit) return;
    versionRef.current += 1;
    setSaveState("dirty");
    schedule();
  };

  /** Makes sure every edit reached the server (used before leaving / converting to PDF). */
  const flush = async () => (savedVersionRef.current === versionRef.current && !inflightRef.current ? true : save(true));

  /* ------------------------------------------------------------ commands */
  const refreshFormats = () => {
    const el = editorRef.current;
    const sel = document.getSelection();
    if (!el || !sel || !sel.anchorNode || !el.contains(sel.anchorNode)) return;
    const q = (c: string) => {
      try {
        return document.queryCommandState(c);
      } catch {
        return false;
      }
    };
    let block: ActiveFormats["block"] = "p";
    try {
      const v = String(document.queryCommandValue("formatBlock") || "").toLowerCase();
      if (v === "h1" || v === "h2") block = v;
    } catch {
      /* ignore */
    }
    setFormats({
      bold: q("bold"),
      italic: q("italic"),
      underline: q("underline"),
      ul: q("insertUnorderedList"),
      ol: q("insertOrderedList"),
      block,
      align: q("justifyCenter") ? "center" : q("justifyRight") ? "right" : "left",
    });
  };

  const onSelectionChange = useEffectEvent(() => refreshFormats());
  useEffect(() => {
    const h = () => onSelectionChange();
    document.addEventListener("selectionchange", h);
    return () => document.removeEventListener("selectionchange", h);
  }, []);

  const exec = (command: string, value?: string) => {
    if (!canEdit) return;
    const el = editorRef.current;
    if (!el) return;
    const sel = document.getSelection();
    if (!sel || !sel.anchorNode || !el.contains(sel.anchorNode)) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    document.execCommand(command, false, value);
    onContentChange();
    refreshFormats();
  };

  const setBlock = (tag: "p" | "h1" | "h2") => exec("formatBlock", formats.block === tag && tag !== "p" ? "<p>" : `<${tag}>`);

  const onContentChange = () => {
    const el = editorRef.current;
    if (el) setIsEmpty(!draftHasContent(el.innerHTML));
    markDirty();
  };

  /* ---------------------------------------------------------- exit / pdf */
  const exit = async () => {
    if (!canEdit) {
      router.push(listHref);
      return;
    }
    setBusy("저장하는 중…");
    const ok = await flush();
    setBusy(null);
    if (ok) router.push(listHref);
    else setExitFailed(true);
  };

  const requestSign = async () => {
    setRequestOpen(false);
    const el = editorRef.current;
    if (!el) return;
    if (!draftHasContent(el.innerHTML)) {
      toast.error("서식 내용을 입력해 주세요.");
      return;
    }
    setBusy("서식을 PDF로 변환하는 중…");
    try {
      if (canEdit && !(await flush())) throw new Error("서식을 저장하지 못했습니다.");
      const docTitle = titleRef.current.trim() || "제목 없는 서식";
      const bytes = await renderDraftPdf(parseDraftDom(el), { title: docTitle, loadFont: loadFontBytes });
      if (bytes.byteLength > MAX_PDF_BYTES) throw new Error("PDF가 10MB를 넘어 서명 요청할 수 없습니다.");
      const info = await readPdfInfo(bytes.slice().buffer as ArrayBuffer);
      setBusy("서명 요청 문서를 만드는 중…");
      const docId = newId();
      const uploadError = await uploadPdf(paths.documentOriginal(wid, docId), bytes);
      if (uploadError) throw new Error("PDF를 업로드하지 못했습니다.");
      const res = await requestSignFromDraft({ wid, id: draft.id, docId, pageCount: info.pageCount, pageSizes: info.pageSizes });
      if (!res.ok) throw new Error(res.error);
      router.push(`/workspaces/${wid}/documents/d/${res.docId}/steps/1`);
    } catch (e) {
      setBusy(null);
      toast.error((e as Error).message || "서명 요청 문서를 만들지 못했습니다.");
    }
  };

  /* ------------------------------------------------------------ keyboard */
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (canEdit && !busy) void save(true).then((ok) => ok && toast.success("저장했습니다."));
    }
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    if (saveState === "saved") return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [saveState]);

  const statusText =
    saveState === "saving"
      ? "저장 중…"
      : saveState === "dirty"
        ? "저장 대기 중"
        : saveState === "error"
          ? "저장 실패 — 다시 시도해 주세요"
          : hydrated
            ? `저장됨 · ${fmtShort(savedAt)}`
            : "저장됨";

  return (
    <EditorFrame>
      <EditorHeader
        onExit={() => void exit()}
        title={title.trim() || "제목 없는 서식"}
        status={
          <div className="flex shrink-0 items-center gap-2">
            {!canEdit && (
              <StatusBadge tone="neutral" dot={false}>
                읽기 전용
              </StatusBadge>
            )}
            {canEdit && (
              <span role="status" className={cn("text-[13px]", saveState === "error" ? "text-negative" : "text-fg-muted")}>
                {statusText}
              </span>
            )}
          </div>
        }
      >
        {canEdit && (
          <HeaderButton
            disabled={saveState === "saving"}
            onClick={async () => {
              if (await save(true)) toast.success("저장했습니다.");
            }}
          >
            저장
          </HeaderButton>
        )}
        <HeaderPrimaryButton icon={<FileDown className="size-4" />} disabled={!!busy} onClick={() => setRequestOpen(true)}>
          PDF로 서명 요청
        </HeaderPrimaryButton>
      </EditorHeader>

      <div className="flex h-12 shrink-0 items-center justify-center gap-1 overflow-x-auto border-b border-line bg-menu px-4" role="toolbar" aria-label="서식 도구">
        <ToolButton label="실행 취소" icon={<Undo2 />} showLabel={false} shortcut="Ctrl+Z" disabled={!canEdit} onClick={() => exec("undo")} />
        <ToolButton label="다시 실행" icon={<Redo2 />} showLabel={false} shortcut="Ctrl+Y" disabled={!canEdit} onClick={() => exec("redo")} />
        <ToolDivider />
        <ToolButton label="본문" icon={<Pilcrow />} showLabel={false} active={formats.block === "p"} disabled={!canEdit} onClick={() => setBlock("p")} />
        <ToolButton label="제목 1" icon={<Heading1 />} showLabel={false} active={formats.block === "h1"} disabled={!canEdit} onClick={() => setBlock("h1")} />
        <ToolButton label="제목 2" icon={<Heading2 />} showLabel={false} active={formats.block === "h2"} disabled={!canEdit} onClick={() => setBlock("h2")} />
        <ToolDivider />
        <ToolButton label="굵게" icon={<Bold />} showLabel={false} shortcut="Ctrl+B" active={formats.bold} disabled={!canEdit} onClick={() => exec("bold")} />
        <ToolButton label="기울임" icon={<Italic />} showLabel={false} shortcut="Ctrl+I" active={formats.italic} disabled={!canEdit} onClick={() => exec("italic")} />
        <ToolButton label="밑줄" icon={<Underline />} showLabel={false} shortcut="Ctrl+U" active={formats.underline} disabled={!canEdit} onClick={() => exec("underline")} />
        <ToolDivider />
        <ToolButton label="글머리 기호" icon={<List />} showLabel={false} active={formats.ul} disabled={!canEdit} onClick={() => exec("insertUnorderedList")} />
        <ToolButton label="번호 목록" icon={<ListOrdered />} showLabel={false} active={formats.ol} disabled={!canEdit} onClick={() => exec("insertOrderedList")} />
        <ToolDivider />
        <ToolButton label="왼쪽 정렬" icon={<TextAlignStart />} showLabel={false} active={formats.align === "left"} disabled={!canEdit} onClick={() => exec("justifyLeft")} />
        <ToolButton label="가운데 정렬" icon={<TextAlignCenter />} showLabel={false} active={formats.align === "center"} disabled={!canEdit} onClick={() => exec("justifyCenter")} />
        <ToolButton label="오른쪽 정렬" icon={<TextAlignEnd />} showLabel={false} active={formats.align === "right"} disabled={!canEdit} onClick={() => exec("justifyRight")} />
        <ToolDivider />
        <ToolButton label="구분선" icon={<SeparatorHorizontal />} showLabel={false} disabled={!canEdit} onClick={() => exec("insertHorizontalRule")} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-max flex-col items-center px-10 pb-20 pt-8">
          <div className="mb-4 w-[794px]">
            <label htmlFor="draft-title" className="sr-only">
              서식 제목
            </label>
            <input
              id="draft-title"
              value={title}
              maxLength={100}
              readOnly={!canEdit}
              placeholder="서식 제목을 입력하세요"
              onChange={(e) => {
                setTitle(e.target.value);
                titleRef.current = e.target.value;
                markDirty();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  editorRef.current?.focus();
                }
              }}
              className="h-14 w-full border-b border-line bg-transparent px-1 text-[22px] font-bold text-fg outline-none placeholder:text-fg-disabled focus:border-emphasis"
            />
          </div>
          <div className="relative">
            <div
              ref={editorRef}
              role="textbox"
              aria-multiline="true"
              aria-label="서식 본문"
              contentEditable={canEdit}
              suppressContentEditableWarning
              spellCheck={false}
              className={SHEET_CSS}
              onInput={onContentChange}
              onKeyUp={refreshFormats}
              onMouseUp={refreshFormats}
              onPaste={(e) => {
                e.preventDefault();
                const text = e.clipboardData.getData("text/plain");
                if (text) document.execCommand("insertText", false, text);
              }}
              onDrop={(e) => e.preventDefault()}
            />
            {isEmpty && (
              <p className="pointer-events-none absolute left-[75.6px] top-[75.6px] text-[14px] leading-[1.6] text-fg-disabled">
                {canEdit ? "내용을 입력하세요. 위 도구로 제목, 목록, 정렬, 구분선을 넣을 수 있어요." : "내용이 없습니다."}
              </p>
            )}
          </div>
          <p className="mt-3 text-xs text-fg-muted">A4 · 여백 20mm — PDF로 변환하면 내용 길이에 맞춰 페이지가 나뉩니다.</p>
        </div>
      </div>

      <ConfirmModal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        onConfirm={() => void requestSign()}
        title="PDF로 서명 요청할까요?"
        description={
          <>
            작성한 서식을 A4 PDF로 변환해 새 서명 요청 문서를 만듭니다.
            <br />
            서식은 그대로 남아 있어 계속 수정할 수 있어요.
          </>
        }
        confirmLabel="PDF로 서명 요청"
      />

      <Modal
        open={exitFailed}
        onClose={() => setExitFailed(false)}
        width={420}
        footerAlign="center"
        footer={
          <>
            <Button variant="light" size="lg" onClick={() => router.push(listHref)}>
              저장하지 않고 나가기
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                setExitFailed(false);
                void exit();
              }}
            >
              다시 저장
            </Button>
          </>
        }
      >
        <div className="px-8 pb-2 pt-8 text-center">
          <h2 className="text-lg font-bold text-fg">변경 사항을 저장하지 못했습니다.</h2>
          <p className="mt-3 text-sm leading-relaxed text-fg-2">저장하지 않고 나가면 마지막 저장 이후의 내용이 사라집니다.</p>
        </div>
      </Modal>

      {busy && <BusyOverlay message={busy} />}
    </EditorFrame>
  );
}
