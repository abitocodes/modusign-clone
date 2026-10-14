"use client";

import type { SignView } from "../_lib/types";
import { IdentityCheck } from "./identity-check";
import { SigningView } from "./signing-view";
import { DonePage, MessagePage } from "./status-pages";

/** Client root of /sign/[token]: picks the screen for the server-computed state. */
export function SignApp({ view, autoReject }: { view: SignView; autoReject: boolean }) {
  switch (view.kind) {
    case "message":
      return <MessagePage message={view.message} view={view.view} reason={view.reason} />;
    case "identity":
      return <IdentityCheck token={view.token} check={view.check} needPassword={view.needPassword} preview={view.preview} />;
    case "sign":
      return <SigningView key={view.doc.token} doc={view.doc} autoReject={autoReject} />;
    case "done":
      return <DonePage key={view.done.token} done={view.done} />;
  }
}
