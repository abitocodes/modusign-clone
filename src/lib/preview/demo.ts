/**
 * Fixed ids of the preview demo accounts / workspaces (src/lib/preview/seed.ts).
 * Stable across `데모 데이터 초기화` and server restarts, so the session cookie and bookmarked URLs keep
 * working. Fictional data only.
 */
export const DEMO = {
  users: {
    admin: "5eed0000-0000-4000-8000-00000000a001",
    minsu: "5eed0000-0000-4000-8000-00000000a002",
    seoyeon: "5eed0000-0000-4000-8000-00000000a003",
  },
  workspaces: {
    company: "5eed0000-0000-4000-8000-00000000b001",
    adminPersonal: "5eed0000-0000-4000-8000-00000000b002",
    minsuPersonal: "5eed0000-0000-4000-8000-00000000b003",
    seoyeonPersonal: "5eed0000-0000-4000-8000-00000000b004",
  },
} as const;

/** The account a preview login with an unknown 아이디 / e-mail signs in as. */
export const DEMO_ADMIN_ID = DEMO.users.admin;
