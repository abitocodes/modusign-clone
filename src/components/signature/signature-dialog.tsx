"use client";

import { User } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Modal } from "@/components/ui/modal";
import { UnderlineTabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { DrawPad, PAD_W, type DrawPadHandle } from "./draw-pad";
import { KOREAN_SIGN_STYLES, LATIN_SIGN_STYLES } from "./fonts";
import {
  ChoiceTile,
  EraseButton,
  NameRow,
  PANEL_CLASS,
  PanelCaption,
  SavedPanel,
  SubmitButton,
  TileSkeleton,
  UploadPanel,
  showSignDrawFailToast,
  type SavedSignature,
} from "./parts";
import { ensureFonts, renderTextSignature, validateDrawing } from "./render";

export interface SignatureDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Receives a trimmed, transparent PNG data URL. The dialog closes itself after it resolves;
   * throw (or reject) to keep it open — the error message is shown as a toast.
   */
  onSubmit: (pngDataUrl: string) => void | Promise<void>;
  /** dialog title (default "사인 입력") */
  title?: string;
  /** prefilled name of the 사인 만들기 tab */
  defaultName?: string;
  /** when provided, an "이용 가능 사인" tab is added and selected first */
  saved?: SavedSignature[];
  /** only the 그리기 tab (field option "그리기만 허용") */
  drawOnly?: boolean;
  /** only the 업로드 tab (field option "업로드만 허용") */
  uploadOnly?: boolean;
}

type Tab = "draw" | "make" | "upload" | "saved";
type Script = "ko" | "en";

const TAB_LABELS: Record<Tab, string> = { draw: "그리기", make: "사인 만들기", upload: "업로드", saved: "이용 가능 사인" };
const SCRIPTS: { value: Script; label: string }[] = [
  { value: "ko", label: "한글" },
  { value: "en", label: "영문" },
];

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;

/** 사인 입력 dialog: 그리기 | 사인 만들기 | 업로드 (| 이용 가능 사인) */
export function SignatureDialog({ open, onClose, title = "사인 입력", ...rest }: SignatureDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      icon={<User fill="currentColor" strokeWidth={1.5} />}
      width={672}
      closeOnBackdrop={false}
      bodyClassName="flex flex-col overflow-hidden"
    >
      <SignatureDialogBody onClose={onClose} {...rest} />
    </Modal>
  );
}

function SignatureDialogBody({ onClose, onSubmit, defaultName = "", saved, drawOnly, uploadOnly }: Omit<SignatureDialogProps, "open" | "title">) {
  const tabs: Tab[] = drawOnly ? ["draw"] : uploadOnly ? ["upload"] : saved ? ["draw", "make", "upload", "saved"] : ["draw", "make", "upload"];
  const [tab, setTab] = useState<Tab>(tabs.includes("saved") ? "saved" : tabs[0]);
  const [busy, setBusy] = useState(false);

  // 그리기
  const padRef = useRef<DrawPadHandle>(null);
  const [hasInk, setHasInk] = useState(false);

  // 사인 만들기
  const [script, setScript] = useState<Script>(HANGUL.test(defaultName) || !/[a-z]/i.test(defaultName) ? "ko" : "en");
  const [name, setName] = useState(defaultName);
  const [renders, setRenders] = useState<{ key: string; png: string }[] | null>(null);
  const [making, setMaking] = useState(false);
  const [madeFor, setMadeFor] = useState<{ name: string; script: Script } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const makeReq = useRef(0);

  // 업로드
  const [uploadPng, setUploadPng] = useState<string | null>(null);

  // 이용 가능 사인
  const [savedId, setSavedId] = useState<string | null>(null);

  const make = async (value: string, sc: Script) => {
    const text = value.trim();
    if (!text) {
      toast.error("이름을 입력해 주세요.");
      return;
    }
    const req = ++makeReq.current;
    setMaking(true);
    setPicked(null);
    const styles = sc === "ko" ? KOREAN_SIGN_STYLES : LATIN_SIGN_STYLES;
    try {
      await ensureFonts(
        styles.map((s) => s.font),
        text,
      );
      if (req !== makeReq.current) return;
      const out = styles.flatMap((s) => {
        const png = renderTextSignature(text, s);
        return png ? [{ key: s.key, png }] : [];
      });
      setRenders(out);
      setMadeFor({ name: text, script: sc });
    } catch {
      if (req === makeReq.current) toast.error("사인을 만들지 못했습니다. 다시 시도해 주세요.");
    } finally {
      if (req === makeReq.current) setMaking(false);
    }
  };

  const changeTab = (t: Tab) => {
    setTab(t);
    if (t === "make" && renders === null && !making && name.trim()) void make(name, script);
  };

  const changeScript = (sc: Script) => {
    setScript(sc);
    if (name.trim()) void make(name, sc);
  };

  const ready =
    (tab === "draw" && hasInk) ||
    (tab === "make" && !!picked && !making) ||
    (tab === "upload" && !!uploadPng) ||
    (tab === "saved" && !!savedId);

  const submit = async () => {
    let png: string | null = null;
    if (tab === "draw") {
      const pad = padRef.current;
      if (!pad) return;
      if (!validateDrawing(pad.strokes(), PAD_W)) {
        showSignDrawFailToast();
        return;
      }
      png = pad.toPng();
    } else if (tab === "make") {
      png = renders?.find((r) => r.key === picked)?.png ?? null;
    } else if (tab === "upload") {
      png = uploadPng;
    } else {
      png = saved?.find((s) => s.id === savedId)?.image_data ?? null;
    }
    if (!png) return;
    setBusy(true);
    try {
      await onSubmit(png);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "사인을 입력하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const latinMismatch = script === "en" && HANGUL.test(name);

  return (
    <>
      {tabs.length > 1 && (
        <UnderlineTabs className="shrink-0" tabs={tabs.map((t) => ({ value: t, label: TAB_LABELS[t] }))} value={tab} onChange={changeTab} />
      )}

      {/* 그리기 — kept mounted so the drawing survives tab switches */}
      <div role="tabpanel" aria-label="그리기" hidden={tab !== "draw"} className={cn(PANEL_CLASS, "px-4", tab !== "draw" && "hidden")}>
        <div className="mx-auto flex w-full max-w-[530px] flex-col items-start pt-[50px]">
          <DrawPad ref={padRef} onInkChange={setHasInk} />
          <div className="mt-1.5">
            <EraseButton onClick={() => padRef.current?.clear()} />
          </div>
        </div>
      </div>

      {tab === "make" && (
        <div role="tabpanel" aria-label="사인 만들기" className={cn(PANEL_CLASS, "px-4 pb-6 pt-[22px]")}>
          <PanelCaption>다양한 모양의 사인을 만들고 마음에 드는 사인을 입력해 보세요.</PanelCaption>
          <NameRow
            script={script}
            scripts={SCRIPTS}
            onScriptChange={changeScript}
            value={name}
            onChange={setName}
            onMake={() => void make(name, script)}
            maxLength={script === "ko" ? 10 : 24}
            makeDisabled={making}
          />
          {latinMismatch && <p className="mx-auto mt-2 max-w-[530px] text-[13px] text-warning">영문 사인은 영문 이름으로 만들어 주세요.</p>}
          <div role="radiogroup" aria-label="만든 사인" className="mx-auto mt-6 grid w-full max-w-[530px] grid-cols-2 gap-2">
            {making || renders === null
              ? Array.from({ length: renders === null && !making ? 0 : 6 }, (_, i) => <TileSkeleton key={i} className="h-[102px]" />)
              : renders.map((r, i) => (
                  <ChoiceTile
                    key={r.key}
                    selected={picked === r.key}
                    onSelect={() => setPicked(r.key)}
                    label={`사인 모양 ${i + 1}`}
                    className="h-[102px]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
                    <img src={r.png} alt="" className={cn("max-h-[66px] max-w-[86%] object-contain", picked === r.key && "invert")} />
                  </ChoiceTile>
                ))}
          </div>
          {!making && renders === null && (
            <p className="mt-10 text-center text-sm text-fg-muted">이름을 입력하고 만들기 버튼을 눌러주세요.</p>
          )}
          {!making && renders !== null && renders.length === 0 && (
            <p className="mt-10 text-center text-sm text-fg-muted">사인을 만들 수 없는 이름입니다. 다른 이름을 입력해 주세요.</p>
          )}
          {madeFor && madeFor.name !== name.trim() && !making && (
            <p className="mx-auto mt-3 max-w-[530px] text-center text-[13px] text-fg-faint">이름을 바꿨다면 만들기 버튼을 다시 눌러주세요.</p>
          )}
        </div>
      )}

      {tab === "upload" && (
        <div role="tabpanel" aria-label="업로드" className={cn(PANEL_CLASS, "px-4")}>
          <UploadPanel value={uploadPng} onChange={setUploadPng} kindLabel="사인" />
        </div>
      )}

      {tab === "saved" && saved && (
        <div role="tabpanel" aria-label="이용 가능 사인" className={cn(PANEL_CLASS, "px-4")}>
          <SavedPanel items={saved} selectedId={savedId} onSelect={setSavedId} kindLabel="사인" />
        </div>
      )}

      <div className="flex h-[67px] shrink-0 items-center justify-center rounded-b border-t border-line-strong bg-modal-foot">
        <SubmitButton disabled={!ready} busy={busy} onClick={() => void submit()} />
      </div>
    </>
  );
}
