"use client";

import { useId, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { EMAIL_DOMAINS } from "@/lib/tools/contacts";
import { cn } from "@/lib/utils";

/** E-mail input with a domain autocomplete listbox (gmail.com, naver.com …). */
export function EmailAutocompleteInput({
  id,
  value,
  onChange,
  invalid,
  placeholder = "이메일 주소",
  describedBy,
  maxLength = 254,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  placeholder?: string;
  describedBy?: string;
  maxLength?: number;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const suggestions = useMemo(() => {
    const v = value.trim();
    if (!v || /\s/.test(v)) return [];
    const at = v.indexOf("@");
    if (at === 0 || (at > -1 && v.indexOf("@", at + 1) > -1)) return [];
    const local = at < 0 ? v : v.slice(0, at);
    const partial = at < 0 ? "" : v.slice(at + 1).toLowerCase();
    return EMAIL_DOMAINS.filter((d) => d.startsWith(partial) && d !== partial).map((d) => `${local}@${d}`);
  }, [value]);

  const show = open && suggestions.length > 0;
  const activeIdx = Math.min(active, Math.max(0, suggestions.length - 1));

  const pick = (s: string) => {
    onChange(s);
    setOpen(false);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        type="email"
        inputMode="email"
        autoComplete="off"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={show ? `${listId}-${activeIdx}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        invalid={invalid}
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!show) {
            if (e.key === "ArrowDown" && suggestions.length > 0) {
              e.preventDefault();
              setOpen(true);
            }
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((activeIdx + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((activeIdx - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(suggestions[activeIdx]);
          } else if (e.key === "Escape") {
            // close the listbox only, not the surrounding dialog
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === "Tab") {
            setOpen(false);
          }
        }}
      />
      {show && (
        <ul
          id={listId}
          role="listbox"
          aria-label="이메일 도메인 추천"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-line-strong bg-menu py-1 shadow-menu"
        >
          {suggestions.map((s, i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIdx}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
              className={cn("flex h-8 cursor-pointer items-center truncate px-3 text-[13px] text-fg", i === activeIdx && "bg-menu-hover")}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
