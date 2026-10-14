"use client";

import { User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { UnderlineTabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import {
  ChoiceTile,
  MakeButton,
  NameRow,
  PANEL_CLASS,
  PanelCaption,
  SavedPanel,
  SubmitButton,
  TileSkeleton,
  UploadPanel,
  type SavedSignature,
} from "./parts";
import { corporateStamps, personalStamps, stampToPng, type StampScript, type StampSpec } from "./stamp";
import { StampSvg } from "./stamp-svg";

export interface StampDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Receives a 300×300 transparent PNG data URL (generated stamps) or a trimmed PNG (uploads).
   * The dialog closes itself after it resolves; throw to keep it open (message shown as a toast).
   */
  onSubmit: (pngDataUrl: string) => void | Promise<void>;
  /** dialog title (default "도장 입력") */
  title?: string;
  /** prefilled name of the 일반 도장 tab */
  defaultName?: string;
  /** prefilled company name of the 법인 도장 tab */
  defaultCompany?: string;
  /** when provided, an "이용 가능 도장" tab is added and selected first */
  saved?: SavedSignature[];
  /** only the 업로드 tab (field option "업로드만 허용") */
  uploadOnly?: boolean;
}

type Tab = "personal" | "corporate" | "upload" | "saved";

const TAB_LABELS: Record<Tab, string> = { personal: "일반 도장", corporate: "법인 도장", upload: "업로드", saved: "이용 가능 도장" };
const SCRIPTS: { value: StampScript; label: string }[] = [
  { value: "ko", label: "한글" },
  { value: "en", label: "영문" },
];
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;

/** 도장 입력 dialog: 일반 도장 | 법인 도장 | 업로드 (| 이용 가능 도장) */
export function StampDialog({ open, onClose, title = "도장 입력", ...rest }: StampDialogProps) {
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
      <StampDialogBody onClose={onClose} {...rest} />
    </Modal>
  );
}

interface GenState {
  specs: StampSpec[] | null;
  loading: boolean;
  picked: string | null;
}

function useStampGenerator(initialLoading: boolean) {
  const [state, setState] = useState<GenState>({ specs: null, loading: initialLoading, picked: null });
  const req = useRef(0);
  const run = async (factory: () => Promise<StampSpec[]>) => {
    const id = ++req.current;
    try {
      const specs = await factory();
      if (id === req.current) setState({ specs, loading: false, picked: null });
    } catch {
      if (id === req.current) {
        setState((s) => ({ ...s, loading: false }));
        toast.error("도장을 만들지 못했습니다. 다시 시도해 주세요.");
      }
    }
  };
  const start = (factory: () => Promise<StampSpec[]>) => {
    setState((s) => ({ ...s, loading: true, picked: null }));
    void run(factory);
  };
  const pick = (key: string) => setState((s) => ({ ...s, picked: key }));
  return { ...state, start, run, pick };
}

function StampGrid({ gen, label }: { gen: ReturnType<typeof useStampGenerator>; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="mx-auto mt-6 grid w-full max-w-[530px] grid-cols-3 gap-2.5 min-[560px]:grid-cols-4">
      {gen.loading
        ? Array.from({ length: 8 }, (_, i) => <TileSkeleton key={i} className="aspect-[124/126] rounded" />)
        : (gen.specs ?? []).map((s, i) => (
            <ChoiceTile
              key={s.key}
              selected={gen.picked === s.key}
              onSelect={() => gen.pick(s.key)}
              label={`도장 모양 ${i + 1}`}
              className="aspect-[124/126] rounded"
            >
              <StampSvg spec={s} size={80} className="h-auto w-[64%]" />
            </ChoiceTile>
          ))}
    </div>
  );
}

function StampDialogBody({ onClose, onSubmit, defaultName = "", defaultCompany = "", saved, uploadOnly }: Omit<StampDialogProps, "open" | "title">) {
  const tabs: Tab[] = uploadOnly ? ["upload"] : saved ? ["personal", "corporate", "upload", "saved"] : ["personal", "corporate", "upload"];
  const initialTab: Tab = tabs.includes("saved") ? "saved" : tabs[0];
  const [tab, setTab] = useState<Tab>(initialTab);
  const [busy, setBusy] = useState(false);

  // 일반 도장
  const [script, setScript] = useState<StampScript>(HANGUL.test(defaultName) || !/[a-z]/i.test(defaultName) ? "ko" : "en");
  const [name, setName] = useState(defaultName);
  const autoPersonal = initialTab === "personal" && !!defaultName.trim();
  const personal = useStampGenerator(autoPersonal);

  // 법인 도장
  const [company, setCompany] = useState(defaultCompany);
  const [role, setRole] = useState("대표이사");
  const corporate = useStampGenerator(false);

  // 업로드 / 이용 가능 도장
  const [uploadPng, setUploadPng] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  // first render of the 일반 도장 tab: show the stamps of the prefilled name right away
  const autoRan = useRef(false);
  const runPersonal = personal.run;
  useEffect(() => {
    if (!autoPersonal || autoRan.current) return;
    autoRan.current = true;
    void runPersonal(() => personalStamps(defaultName, script));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once with the initial values
  }, []);

  const makePersonal = (value = name, sc = script) => {
    if (!value.trim()) {
      toast.error("이름을 입력해 주세요.");
      return;
    }
    personal.start(() => personalStamps(value, sc));
  };

  const makeCorporate = () => {
    if (!company.trim()) {
      toast.error("회사 이름을 입력해 주세요.");
      return;
    }
    corporate.start(() => corporateStamps(company, role));
  };

  const changeTab = (t: Tab) => {
    setTab(t);
    if (t === "personal" && personal.specs === null && !personal.loading && name.trim()) makePersonal();
    if (t === "corporate" && corporate.specs === null && !corporate.loading && company.trim()) makeCorporate();
  };

  const pickedSpec = (g: GenState) => g.specs?.find((s) => s.key === g.picked) ?? null;

  const ready =
    (tab === "personal" && !personal.loading && !!pickedSpec(personal)) ||
    (tab === "corporate" && !corporate.loading && !!pickedSpec(corporate)) ||
    (tab === "upload" && !!uploadPng) ||
    (tab === "saved" && !!savedId);

  const submit = async () => {
    let png: string | null = null;
    try {
      if (tab === "personal" || tab === "corporate") {
        const spec = pickedSpec(tab === "personal" ? personal : corporate);
        png = spec ? stampToPng(spec) : null;
      } else if (tab === "upload") {
        png = uploadPng;
      } else {
        png = saved?.find((s) => s.id === savedId)?.image_data ?? null;
      }
    } catch {
      toast.error("도장 이미지를 만들지 못했습니다. 다시 시도해 주세요.");
      return;
    }
    if (!png) return;
    setBusy(true);
    try {
      await onSubmit(png);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "도장을 입력하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {tabs.length > 1 && (
        <UnderlineTabs className="shrink-0" tabs={tabs.map((t) => ({ value: t, label: TAB_LABELS[t] }))} value={tab} onChange={changeTab} />
      )}

      {tab === "personal" && (
        <div role="tabpanel" aria-label="일반 도장" className={cn(PANEL_CLASS, "px-4 pb-6 pt-[22px]")}>
          <PanelCaption>다양한 모양의 도장을 만들고 마음에 드는 도장을 입력해 보세요.</PanelCaption>
          <NameRow
            script={script}
            scripts={SCRIPTS}
            onScriptChange={(sc) => {
              setScript(sc);
              if (name.trim()) makePersonal(name, sc);
            }}
            value={name}
            onChange={setName}
            onMake={() => makePersonal()}
            maxLength={script === "ko" ? 8 : 20}
            makeDisabled={personal.loading}
          />
          {script === "en" && HANGUL.test(name) && (
            <p className="mx-auto mt-2 max-w-[530px] text-[13px] text-warning">영문 도장은 영문 이름으로 만들어 주세요.</p>
          )}
          {personal.specs === null && !personal.loading ? (
            <p className="mt-10 text-center text-sm text-fg-muted">이름을 입력하고 만들기 버튼을 눌러주세요.</p>
          ) : (
            <StampGrid gen={personal} label="만든 도장" />
          )}
        </div>
      )}

      {tab === "corporate" && (
        <div role="tabpanel" aria-label="법인 도장" className={cn(PANEL_CLASS, "px-4 pb-6 pt-[22px]")}>
          <PanelCaption>회사 이름으로 법인 도장을 만들고 마음에 드는 도장을 입력해 보세요.</PanelCaption>
          <div className="mx-auto mt-4 flex w-full max-w-[530px] items-center gap-1.5">
            <Input
              aria-label="회사 이름"
              className="min-w-0 flex-1 border-line"
              value={company}
              maxLength={16}
              placeholder="회사 이름 (예: 주식회사 오픈사인)"
              onChange={(e) => setCompany(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  makeCorporate();
                }
              }}
            />
            <Input
              aria-label="직함"
              className="w-[104px] shrink-0 border-line"
              value={role}
              maxLength={6}
              placeholder="직함"
              onChange={(e) => setRole(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  makeCorporate();
                }
              }}
            />
            <MakeButton onClick={makeCorporate} disabled={corporate.loading} />
          </div>
          {corporate.specs === null && !corporate.loading ? (
            <p className="mt-10 text-center text-sm leading-relaxed text-fg-muted">
              회사 이름을 입력하고 만들기 버튼을 눌러주세요.
              <br />
              <span className="text-[13px] text-fg-faint">사각 도장은 &lsquo;회사 이름 + 직함 + 인&rsquo;, 원형 도장은 테두리에 회사 이름이 들어갑니다.</span>
            </p>
          ) : (
            <StampGrid gen={corporate} label="만든 법인 도장" />
          )}
        </div>
      )}

      {tab === "upload" && (
        <div role="tabpanel" aria-label="업로드" className={cn(PANEL_CLASS, "px-4")}>
          <UploadPanel value={uploadPng} onChange={setUploadPng} kindLabel="도장" />
        </div>
      )}

      {tab === "saved" && saved && (
        <div role="tabpanel" aria-label="이용 가능 도장" className={cn(PANEL_CLASS, "px-4")}>
          <SavedPanel items={saved} selectedId={savedId} onSelect={setSavedId} kindLabel="도장" />
        </div>
      )}

      <div className="flex h-[67px] shrink-0 items-center justify-center rounded-b border-t border-line-strong bg-modal-foot">
        <SubmitButton disabled={!ready} busy={busy} onClick={() => void submit()} />
      </div>
    </>
  );
}
