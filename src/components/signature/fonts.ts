/**
 * Web fonts used to generate signatures (사인 만들기) and stamps (도장 만들기).
 *
 * All fonts are self-hosted by next/font and never preloaded: the browser only downloads the
 * unicode-range slices that are actually drawn, and only when a dialog renders them.
 * Rendering code waits for them with `document.fonts.load()` before drawing on a canvas.
 */
import {
  Alex_Brush,
  Allura,
  Black_Han_Sans,
  Caveat,
  Dancing_Script,
  Dokdo,
  East_Sea_Dokdo,
  Gaegu,
  Gamja_Flower,
  Great_Vibes,
  Hi_Melody,
  Homemade_Apple,
  Kalam,
  Mrs_Saint_Delafield,
  Nanum_Brush_Script,
  Nanum_Myeongjo,
  Nanum_Pen_Script,
  Orbit,
  Sacramento,
  Satisfy,
  Song_Myung,
  Yeon_Sung,
} from "next/font/google";

/* ----------------------------------------------------------- handwriting: 한글 */
const nanumPen = Nanum_Pen_Script({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["cursive"] });
const nanumBrush = Nanum_Brush_Script({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["cursive"] });
const gaegu = Gaegu({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["cursive"] });
const hiMelody = Hi_Melody({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["cursive"] });
const gamjaFlower = Gamja_Flower({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["cursive"] });
const yeonSung = Yeon_Sung({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["cursive"] });
const eastSeaDokdo = East_Sea_Dokdo({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["cursive"] });
const dokdo = Dokdo({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["cursive"] });

/* ----------------------------------------------------------- handwriting: 영문 */
const dancing = Dancing_Script({ weight: "600", preload: false, adjustFontFallback: false, fallback: ["cursive"] });
const greatVibes = Great_Vibes({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["cursive"] });
const sacramento = Sacramento({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["cursive"] });
const caveat = Caveat({ weight: "500", preload: false, adjustFontFallback: false, fallback: ["cursive"] });
const allura = Allura({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["cursive"] });
const kalam = Kalam({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["cursive"] });
const homemadeApple = Homemade_Apple({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["cursive"] });
const mrsSaint = Mrs_Saint_Delafield({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["cursive"] });
const alexBrush = Alex_Brush({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["cursive"] });
const satisfy = Satisfy({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["cursive"] });

/* ----------------------------------------------------------- stamps */
const orbit = Orbit({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["sans-serif"] });
const myeongjo = Nanum_Myeongjo({ weight: "700", preload: false, adjustFontFallback: false, fallback: ["serif"] });
const blackHanSans = Black_Han_Sans({ weight: "400", preload: false, adjustFontFallback: false, fallback: ["sans-serif"] });
const songMyung = Song_Myung({ weight: "400", adjustFontFallback: false, fallback: ["serif"] });

export interface FontRef {
  /** CSS font-family list (usable in `ctx.font` and SVG `font-family`) */
  family: string;
  weight: number;
}

export interface SignStyle {
  key: string;
  font: FontRef;
  /** extra horizontal skew (radians) — used for the slanted variants */
  skew?: number;
  /** relative glyph size tweak (some script fonts have tiny x-heights) */
  scale?: number;
}

const ref = (f: { style: { fontFamily: string } }, weight = 400): FontRef => ({ family: f.style.fontFamily, weight });

/** 10 Korean handwriting renderings (8 fonts + 2 slanted variants) */
export const KOREAN_SIGN_STYLES: SignStyle[] = [
  { key: "nanum-pen", font: ref(nanumPen), scale: 1.15 },
  { key: "nanum-brush", font: ref(nanumBrush), scale: 1.1 },
  { key: "gaegu", font: ref(gaegu) },
  { key: "hi-melody", font: ref(hiMelody), scale: 1.05 },
  { key: "gamja-flower", font: ref(gamjaFlower) },
  { key: "yeon-sung", font: ref(yeonSung) },
  { key: "east-sea-dokdo", font: ref(eastSeaDokdo), scale: 1.2 },
  { key: "dokdo", font: ref(dokdo) },
  { key: "nanum-pen-slant", font: ref(nanumPen), scale: 1.15, skew: -0.28 },
  { key: "nanum-brush-slant", font: ref(nanumBrush), scale: 1.1, skew: -0.22 },
];

/** 10 Latin handwriting renderings */
export const LATIN_SIGN_STYLES: SignStyle[] = [
  { key: "dancing-script", font: ref(dancing, 600) },
  { key: "great-vibes", font: ref(greatVibes), scale: 1.1 },
  { key: "sacramento", font: ref(sacramento), scale: 1.2 },
  { key: "caveat", font: ref(caveat, 500) },
  { key: "allura", font: ref(allura), scale: 1.15 },
  { key: "kalam", font: ref(kalam) },
  { key: "homemade-apple", font: ref(homemadeApple), scale: 0.9 },
  { key: "mrs-saint-delafield", font: ref(mrsSaint), scale: 1.25 },
  { key: "alex-brush", font: ref(alexBrush), scale: 1.1 },
  { key: "satisfy", font: ref(satisfy) },
];

/** Fonts for 도장 generation */
export const STAMP_FONTS = {
  /** thin geometric strokes — stretched into the cells it gives a 전서(篆書)-like look */
  seal: ref(orbit),
  /** classic 명조 */
  serif: ref(myeongjo, 700),
  /** heavy 고딕 */
  bold: ref(blackHanSans),
  /** traditional brush-serif */
  brush: ref(songMyung),
} satisfies Record<string, FontRef>;
