"use client";

import { ChevronLeft, ChevronRight, LoaderCircle, MessageSquareText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { SignatureDialog, SignMethodPicker, StampDialog } from "@/components/signature";
import { ConfirmModal } from "@/components/ui/modal";
import { cn, participantColor } from "@/lib/utils";

import { markViewed, rejectSignature, saveDraft, submitSignature } from "../actions";
import { callAction, type SignDocument, type SignerField } from "../_lib/types";
import { fieldError, fieldLabel, hasValue, initialValue, isCounted, isManual } from "../_lib/validate";
import { Card, CardPage, SignTopBar } from "./chrome";
import { ConsentModal, RejectModal } from "./dialogs";
import { DocumentPane, ZoomControls, useZoom } from "./document-viewer";
import { StatusIcon } from "./illustrations";
import { FilledFieldView, GuideTab, MyField } from "./signer-field";

type Mode = "preview" | "signing" | "exited";
type SigFlow = { fieldId: string; step: "pick" | "sign" | "stamp" };

/** reading order: page, then rows (fields whose centres are close count as one row), then left → right */
const byPosition = (a: SignerField, b: SignerField) => {
  if (a.page !== b.page) return a.page - b.page;
  const dy = a.y + a.height / 2 - (b.y + b.height / 2);
  return Math.abs(dy) > Math.min(a.height, b.height) / 2 ? dy : a.x - b.x;
};

/** Tab body width minus its tip that may overlap the page (see GuideTab) */
const TAB_REACH = 81;

/**
 * 문서 미리보기 → 서명 모드 → 내용 확인 및 전자서명 동의.
 * Only my fields are interactive; other participants' submitted values are drawn as content.
 */
export function SigningView({ doc, autoReject }: { doc: SignDocument; autoReject: boolean }) {
  const router = useRouter();
  const z = useZoom();
  const color = participantColor(doc.me.colorIndex);
  const isView = doc.requestType === "view";
  const verb = isView ? "열람" : "서명";

  // a later server render would sign a new URL — keep the first one so pdf.js does not reload
  const [pdfUrl] = useState(doc.pdfUrl);
  const ordered = useMemo(() => doc.myFields.filter(isManual).sort(byPosition), [doc.myFields]);

  const [mode, setMode] = useState<Mode>("preview");
  // last values the server knows about (initial / 임시저장) — restored when the signer leaves
  const [savedValues, setSavedValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(doc.myFields.filter(isManual).map((f) => [f.id, initialValue(f, doc.draft, f.id, doc.me.name)])),
  );
  const [values, setValues] = useState<Record<string, string>>(savedValues);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sigFlow, setSigFlow] = useState<SigFlow | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [viewConfirmOpen, setViewConfirmOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(autoReject && doc.menu.canReject);
  const [exitOpen, setExitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [saving, startSaving] = useTransition();
  const [, startRefresh] = useTransition();
  const paneRef = useRef<HTMLDivElement>(null);

  /* -------------------------------------------------------------- effects */

  // first display after the identity check → "viewed" (audit trail)
  useEffect(() => {
    if (!doc.me.viewed) void callAction(() => markViewed(doc.token));
  }, [doc.me.viewed, doc.token]);

  // ?action=reject is consumed once
  useEffect(() => {
    if (autoReject) window.history.replaceState(null, "", window.location.pathname);
  }, [autoReject]);

  useEffect(() => {
    if (!dirty || mode !== "signing") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, mode]);

  /* ------------------------------------------------------------- progress */

  const complete = useCallback((f: SignerField) => hasValue(f, values[f.id]) && !fieldError(f, values[f.id]), [values]);
  const counted = ordered.filter(isCounted);
  const doneCount = counted.filter(complete).length;
  const remaining = counted.length - doneCount;
  const allDone = remaining === 0;

  const errorOf = (f: SignerField) => (attempted ? fieldError(f, values[f.id]) : touched.has(f.id) ? fieldError(f, values[f.id], false) : null);

  /* ----------------------------------------------------------- navigation */

  const focusField = useCallback((id: string) => {
    setCurrentId(id);
    const el = paneRef.current?.querySelector<HTMLElement>(`[data-field-id="${id}"]`);
    if (!el) return;
    // focus first: focusing during a smooth scroll can cancel it
    el.querySelector<HTMLElement>("[data-field-control]")?.focus({ preventScroll: true });
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    // smooth scrolling can be interrupted (layout change, throttled tab) — make sure the field ends up visible
    window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      const pane = el.closest<HTMLElement>("[data-sign-scroller]")?.getBoundingClientRect();
      const top = pane?.top ?? 0;
      const bottom = pane?.bottom ?? window.innerHeight;
      if (r.top < top || r.bottom > bottom) el.scrollIntoView({ block: "center" });
    }, 700);
  }, []);

  /** next required field that is not complete, after `afterId` (wrapping around) */
  const nextOpen = (afterId: string | null) => {
    const open = ordered.filter((f) => isCounted(f) && !complete(f));
    if (open.length === 0) return null;
    const idx = afterId ? ordered.findIndex((f) => f.id === afterId) : -1;
    return open.find((f) => ordered.indexOf(f) > idx) ?? open[0];
  };

  const startSigning = () => {
    setMode("signing");
    const first = nextOpen(null) ?? ordered[0];
    if (first) window.setTimeout(() => focusField(first.id), 80);
  };

  const validateAll = () => {
    const bad = ordered.find((f) => fieldError(f, values[f.id]));
    if (!bad) return true;
    setAttempted(true);
    focusField(bad.id);
    toast.error(`${fieldLabel(bad)}: ${fieldError(bad, values[bad.id])}`);
    return false;
  };

  const goNext = () => {
    // leaving a field with a wrong format: say why it still counts as open
    const cur = currentId ? ordered.find((f) => f.id === currentId) : undefined;
    const curError = cur && hasValue(cur, values[cur.id]) ? fieldError(cur, values[cur.id], false) : null;
    if (cur && curError) {
      markTouched(cur.id);
      toast.error(`${fieldLabel(cur)}: ${curError}`);
    }
    const next = nextOpen(currentId);
    if (next) {
      focusField(next.id);
      return;
    }
    if (validateAll()) setConsentOpen(true);
  };

  /* -------------------------------------------------------------- editing */

  const setValue = useCallback((id: string, value: string) => {
    setValues((prev) => ({ ...prev, [id]: value }));
    setDirty(true);
  }, []);

  const markTouched = useCallback((id: string) => {
    setTouched((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const sigField = sigFlow ? ordered.find((f) => f.id === sigFlow.fieldId) ?? null : null;

  const openSignature = useCallback((f: SignerField) => {
    setCurrentId(f.id);
    const m = f.options.signMode ?? "any";
    setSigFlow({ fieldId: f.id, step: m === "any" ? "pick" : m });
  }, []);

  const applySignature = (png: string) => {
    const f = sigField;
    if (!f) return;
    setValues((prev) => {
      const next = { ...prev, [f.id]: png };
      // 한 번에 서명: one signature fills every empty signature field of mine that allows it
      if (f.options.batchSign) {
        for (const o of ordered) if (o.type === "signature" && o.options.batchSign && !hasValue(o, prev[o.id])) next[o.id] = png;
      }
      return next;
    });
    setDirty(true);
    markTouched(f.id);
  };

  /* -------------------------------------------------------------- actions */

  const onSaveDraft = () =>
    startSaving(async () => {
      const res = await callAction(() => saveDraft(doc.token, values));
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSavedValues(values);
      setDirty(false);
      toast.success("임시저장되었습니다. 같은 링크로 이어서 진행할 수 있습니다.");
    });

  const onSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    const res = await callAction(() => submitSignature(doc.token, values));
    if (!res.ok) {
      setSubmitting(false);
      setConsentOpen(false);
      setViewConfirmOpen(false);
      toast.error(res.error);
      return;
    }
    setDirty(false);
    toast.success(res.data?.completed ? `모든 ${verb}이 완료되었습니다.` : `${verb}을 완료했습니다.`);
    startRefresh(() => router.refresh());
  };

  const onReject = async (reason: string) => {
    setRejecting(true);
    const res = await callAction(() => rejectSignature(doc.token, reason));
    if (!res.ok) {
      setRejecting(false);
      toast.error(res.error);
      return;
    }
    setDirty(false);
    toast.success("서명을 거절했습니다.");
    startRefresh(() => router.refresh());
  };

  /* -------------------------------------------------------------- render */

  if (mode === "exited") {
    return (
      <CardPage menu={doc.menu} onReject={() => setRejectOpen(true)}>
        <Card className="max-w-[414px] px-6 py-14">
          <div className="flex flex-col items-center text-center">
            <StatusIcon tone="neutral">
              <ChevronLeft />
            </StatusIcon>
            <h1 className="mt-5 text-xl font-bold text-fg">{verb}을 중단했습니다.</h1>
            <div className="mt-2 text-[13px] font-medium leading-relaxed text-fg-2">
              <p>메일로 받은 링크를 다시 열면</p>
              <p>언제든 {verb}을 이어서 진행할 수 있습니다.</p>
            </div>
            <button
              type="button"
              onClick={() => setMode("preview")}
              className="mt-8 h-10 rounded bg-primary px-[22px] text-sm font-bold text-primary-fg shadow-button hover:bg-primary-hover"
            >
              문서로 돌아가기
            </button>
          </div>
        </Card>
        <RejectModal open={rejectOpen} busy={rejecting} onClose={() => setRejectOpen(false)} onReject={onReject} />
      </CardPage>
    );
  }

  const signing = mode === "signing";
  const guide = signing && currentId ? ordered.find((f) => f.id === currentId) ?? null : null;

  const banner =
    !signing && doc.me.message ? (
      <div className="w-full max-w-[816px] rounded-xl border border-emphasis-border bg-emphasis-bg px-4 py-3">
        <p className="flex items-center gap-1.5 text-[13px] font-bold text-emphasis">
          <MessageSquareText className="size-4" />
          {doc.requester.name}님이 남긴 말
        </p>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-fg">{doc.me.message}</p>
      </div>
    ) : null;

  const primaryBtn =
    "flex h-12 w-full max-w-[180px] items-center justify-center gap-0.5 rounded-md border text-base font-medium transition-colors disabled:cursor-default disabled:opacity-60";
  const exitBtn = (
    <button
      type="button"
      onClick={() => setExitOpen(true)}
      disabled={submitting}
      className={cn(primaryBtn, "border-line bg-btn-light text-fg-2 hover:bg-btn-base")}
    >
      <ChevronLeft className="size-4" />
      나가기
    </button>
  );

  return (
    <div ref={paneRef} className="flex h-dvh flex-col bg-body-2">
      <SignTopBar
        tall
        menu={doc.menu}
        onReject={() => setRejectOpen(true)}
        before={
          signing && !isView ? (
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={saving}
              className="flex h-9 w-20 items-center justify-center gap-1 rounded border border-line bg-btn-light text-sm font-medium text-fg-2 hover:bg-btn-base disabled:opacity-60"
            >
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : "임시저장"}
            </button>
          ) : null
        }
        after={<ZoomControls z={z} />}
      />

      <DocumentPane
        pdfUrl={pdfUrl}
        pageSizes={doc.pageSizes}
        documentId={doc.documentId}
        zoom={z.zoom}
        banner={banner}
        renderOverlay={({ page, scale, gutter }) => (
          <>
            {doc.otherFields
              .filter((f) => f.page === page)
              .map((f) => (
                <FilledFieldView key={f.id} f={f} scale={scale} />
              ))}
            {doc.myFields
              .filter((f) => f.page === page)
              .map((f) => (
                <MyField
                  key={f.id}
                  f={f}
                  value={values[f.id] ?? ""}
                  scale={scale}
                  color={color}
                  interactive={signing}
                  current={currentId === f.id}
                  error={signing ? errorOf(f) : null}
                  today={doc.today}
                  onActivate={setCurrentId}
                  onChange={setValue}
                  onBlur={markTouched}
                  onSign={openSignature}
                />
              ))}
            {guide && guide.page === page && (
              <GuideTab
                top={(guide.y + guide.height / 2) * scale}
                // phones: a compact tab hugging the screen edge, so it covers as little of the page as possible
                left={gutter < 60 ? -Math.max(0, gutter - 2) : -Math.max(0, Math.min(TAB_REACH, gutter - 6))}
                compact={gutter < 60}
                onClick={goNext}
              />
            )}
          </>
        )}
      />

      {signing ? (
        <footer className="flex shrink-0 flex-col items-center justify-center gap-4 border-t border-line bg-surface px-4 py-5 sm:h-[135px]">
          <p className="text-center text-lg font-bold text-fg sm:text-2xl" aria-live="polite">
            {allDone
              ? `필요한 입력란을 모두 완성했습니다. (${doneCount} / ${counted.length})`
              : `완성해야 할 입력란이 ${remaining}개 남았습니다. (${doneCount} / ${counted.length})`}
          </p>
          <div className="flex w-full justify-center gap-2">
            {exitBtn}
            <button
              type="button"
              onClick={goNext}
              disabled={submitting}
              className={cn(
                primaryBtn,
                "border-primary-border text-primary-fg",
                allDone ? "bg-primary hover:bg-primary-hover" : "bg-primary-hover hover:bg-primary",
              )}
            >
              {allDone ? "입력 완료" : "다음으로"}
              <ChevronRight className="size-4" />
            </button>
          </div>
        </footer>
      ) : (
        <footer className="flex h-[74px] shrink-0 items-center justify-center gap-2 border-t border-line bg-surface px-4">
          {exitBtn}
          <button
            type="button"
            onClick={() => (isView ? setViewConfirmOpen(true) : startSigning())}
            disabled={submitting}
            className={cn(primaryBtn, "border-primary-border bg-primary text-primary-fg hover:bg-primary-hover")}
          >
            {isView && submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {isView ? "열람 완료" : "서명 시작하기"}
            {!(isView && submitting) && <ChevronRight className="size-4" />}
          </button>
        </footer>
      )}

      {/* 사인·도장 */}
      <SignMethodPicker
        open={sigFlow?.step === "pick"}
        onClose={() => setSigFlow(null)}
        onPick={(kind) => setSigFlow((s) => (s ? { ...s, step: kind } : s))}
      />
      <SignatureDialog
        open={sigFlow?.step === "sign"}
        onClose={() => setSigFlow(null)}
        onSubmit={applySignature}
        defaultName={doc.me.name}
        saved={sigField?.options.drawOnly ? undefined : doc.savedSigns}
        drawOnly={!!sigField?.options.drawOnly}
      />
      <StampDialog
        open={sigFlow?.step === "stamp"}
        onClose={() => setSigFlow(null)}
        onSubmit={applySignature}
        defaultName={doc.me.name}
        saved={sigField?.options.uploadOnly ? undefined : doc.savedStamps}
        uploadOnly={!!sigField?.options.uploadOnly}
      />

      <ConsentModal open={consentOpen} busy={submitting} onClose={() => setConsentOpen(false)} onAgree={onSubmit} />
      <ConfirmModal
        open={viewConfirmOpen}
        onClose={() => setViewConfirmOpen(false)}
        onConfirm={onSubmit}
        title="열람을 완료할까요?"
        description="문서 내용을 모두 확인했다면 열람 완료를 눌러 주세요. 요청자에게 열람 완료가 기록됩니다."
        confirmLabel="열람 완료"
      />
      <RejectModal open={rejectOpen} busy={rejecting} onClose={() => setRejectOpen(false)} onReject={onReject} />
      <ConfirmModal
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        onConfirm={() => {
          setValues(savedValues);
          setDirty(false);
          setAttempted(false);
          setTouched(new Set());
          setCurrentId(null);
          setMode("exited");
        }}
        title={`${verb}을 중단할까요?`}
        description={
          dirty && signing ? "임시저장하지 않은 입력 내용은 사라집니다. 저장하려면 먼저 ‘임시저장’을 눌러 주세요." : "메일로 받은 링크로 언제든 다시 진행할 수 있습니다."
        }
        confirmLabel="나가기"
      />
    </div>
  );
}
