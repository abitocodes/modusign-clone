/**
 * Stand-in for `@/components/preview` outside preview mode (next.config.ts `turbopack.resolveAlias`):
 * the same exports, all inert, with no preview copy or code. Typed against ./index so the two
 * cannot drift apart.
 */
import type * as Preview from "./index";

export const previewFieldValue: typeof Preview.previewFieldValue = () => "";
export const PreviewAutoFillButton: typeof Preview.PreviewAutoFillButton = () => null;
export const PreviewBadge: typeof Preview.PreviewBadge = () => null;
export const PreviewIdentitySkip: typeof Preview.PreviewIdentitySkip = () => null;
export const PREVIEW_LOGIN_ID: typeof Preview.PREVIEW_LOGIN_ID = undefined;
export const PreviewLoginHint: typeof Preview.PreviewLoginHint = () => null;
export const PreviewSignerTools: typeof Preview.PreviewSignerTools = () => null;
