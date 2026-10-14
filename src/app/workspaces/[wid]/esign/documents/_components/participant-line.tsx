"use client";

import { Check, X } from "lucide-react";

import { displayParticipantStatus, type PublicParticipant } from "@/lib/documents/view";
import type { DocStatus, RequestType, SigningOrder } from "@/lib/types";
import { cn } from "@/lib/utils";

import { LocalTime } from "./local-time";

/** Small rounded status pill used in the row panel and the viewer side panel. */
export function ParticipantPill({ p, requestType, docStatus }: { p: PublicParticipant; requestType: RequestType; docStatus: DocStatus }) {
  const view = requestType === "view";
  const base = "inline-flex h-[18px] shrink-0 items-center whitespace-nowrap rounded-full px-1.5 text-[11px] font-medium leading-none";
  switch (displayParticipantStatus(p.status, docStatus)) {
    case "signed":
      return (
        <span className={cn(base, "bg-fg-disabled text-white")}>
          {view ? "열람" : "서명"}&nbsp;
          <LocalTime iso={p.signed_at ?? p.viewed_at} variant="dash" />
        </span>
      );
    case "viewed":
      return (
        <span className={cn(base, view ? "bg-fg-disabled text-white" : "bg-radio-on text-white")}>
          {view ? (
            <>
              열람&nbsp;
              <LocalTime iso={p.viewed_at} variant="dash" />
            </>
          ) : (
            "서명 필요"
          )}
        </span>
      );
    case "pending":
      return <span className={cn(base, "bg-radio-on text-white")}>{view ? "열람 필요" : "서명 필요"}</span>;
    case "rejected":
      return <span className={cn(base, "border border-negative-border bg-negative-bg text-negative")}>서명 거절</span>;
    case "waiting":
      return <span className={cn(base, "border border-fg-faint text-fg-muted")}>대기 중</span>;
    case "stopped":
      return <span className={cn(base, "border border-line-strong text-fg-faint")}>{view ? "미열람" : "미서명"}</span>;
  }
}

/**
 * "✓ 이름 (email) [서명 2026-10-14 12:59]" / "1. 이름 (email) [서명 필요]" / "3. 이름 (email) [대기 중]".
 * Client-only (dates use the viewer's local time).
 */
export function ParticipantLine({
  p,
  index,
  order,
  requestType,
  docStatus,
  isMe,
}: {
  p: PublicParticipant;
  index: number;
  order: SigningOrder;
  requestType: RequestType;
  docStatus: DocStatus;
  isMe?: boolean;
}) {
  const status = displayParticipantStatus(p.status, docStatus);
  const done = status === "signed" || (requestType === "view" && status === "viewed");
  const active = status === "pending" || (requestType === "sign" && status === "viewed");
  const label = `${p.name || "이름 없음"}${p.email ? ` (${p.email})` : ""}`;
  return (
    <li className="flex min-h-6 items-center gap-1.5 text-sm">
      <span className="flex w-4 shrink-0 justify-center text-[13px]">
        {done ? (
          <Check className="size-3.5 text-fg-3" strokeWidth={2.5} />
        ) : status === "rejected" ? (
          <X className="size-3.5 text-negative" strokeWidth={2.5} />
        ) : order === "sequential" ? (
          <span className={active ? "font-bold text-emphasis" : "text-fg-muted"}>{index + 1}.</span>
        ) : null}
      </span>
      <span
        className={cn(
          "min-w-0 truncate",
          done && "text-fg-3",
          active && "font-bold text-emphasis",
          (status === "waiting" || status === "stopped") && "text-fg-muted",
          status === "rejected" && "text-negative",
        )}
      >
        {label}
        {isMe && <span className="ml-1 text-xs font-medium text-fg-faint">(나)</span>}
      </span>
      <ParticipantPill p={p} requestType={requestType} docStatus={docStatus} />
      {active && p.expires_at && (
        <span className="whitespace-nowrap text-xs text-fg-faint">
          만료 <LocalTime iso={p.expires_at} variant="dash" />
        </span>
      )}
    </li>
  );
}
