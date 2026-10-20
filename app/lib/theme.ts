// Themes: what one may set, how a value is checked, and the CSS written
// from it. Safe to import from client and server, and from scripts Node
// runs directly.
//
// A theme's values are parsed into numbers once, when it is saved, and the
// store keeps only those numbers. The CSS is printed from them, so nothing
// an author typed ever reaches the page as text: a ban on `url(` can be
// spelled around with a CSS escape (knowledge/themes.md), and a number
// can't. printTheme checks every field again as it prints, so a store row
// written some other way can give a wrong colour, never text.

import { z } from "zod";

// Every token a theme may set, and what kind of value it takes. Allowlist,
// never denylist: tests/theme.test.ts checks this against app.css, so a new
// token there needs a decision here. Not the engines' colours, which are
// Anthropic's, OpenAI's and Cursor's own, nor the --color-*, --radius-* and
// --font-* that app.css works out from these.
export const THEME_TOKENS = {
  "--brand-primary": "colour",
  "--brand-secondary": "colour",
  "--brand-foreground": "colour",
  "--background": "colour",
  "--foreground": "colour",
  "--card": "colour",
  "--card-foreground": "colour",
  "--popover": "colour",
  "--popover-foreground": "colour",
  "--primary": "colour",
  "--primary-foreground": "colour",
  "--secondary": "colour",
  "--secondary-foreground": "colour",
  "--muted": "colour",
  "--muted-foreground": "colour",
  "--accent": "colour",
  "--accent-foreground": "colour",
  "--destructive": "colour",
  "--border": "colour",
  "--input": "colour",
  "--ring": "colour",
  "--chart-1": "colour",
  "--chart-2": "colour",
  "--chart-3": "colour",
  "--chart-4": "colour",
  "--chart-5": "colour",
  "--sidebar": "colour",
  "--sidebar-foreground": "colour",
  "--sidebar-primary": "colour",
  "--sidebar-primary-foreground": "colour",
  "--sidebar-accent": "colour",
  "--sidebar-accent-foreground": "colour",
  "--sidebar-border": "colour",
  "--sidebar-ring": "colour",
  "--warning": "colour",
  "--warning-foreground": "colour",
  "--warning-text": "colour",
  "--success": "colour",
  "--info": "colour",
  "--attention": "colour",
  "--attention-foreground": "colour",
  "--pinned": "colour",
  "--column-idle": "colour",
  "--column-waiting": "colour",
  "--column-working": "colour",
  "--column-done": "colour",
  "--column-pinned": "colour",
  "--column-attention": "colour",
  "--line-highlight": "colour",
  "--scrollbar-thumb": "colour",
  "--scrollbar-thumb-hover": "colour",
  "--project-color-1": "colour",
  "--project-color-2": "colour",
  "--project-color-3": "colour",
  "--project-color-4": "colour",
  "--project-color-5": "colour",
  "--project-color-6": "colour",
  "--project-color-7": "colour",
  "--project-color-8": "colour",
  "--project-color-9": "colour",
  "--project-color-10": "colour",
  "--project-color-11": "colour",
  "--project-color-12": "colour",
  "--hl-keyword": "colour",
  "--hl-title": "colour",
  "--hl-string": "colour",
  "--hl-number": "colour",
  "--hl-comment": "colour",
  "--hl-name": "colour",
  "--hl-attr": "colour",
  "--hl-meta": "colour",
  "--background-image": "image",
  "--input-image": "image",
  "--watermark-image": "image",
  "--watermark-opacity": "fraction",
  "--radius": "length",
} as const;
export type ThemeToken = keyof typeof THEME_TOKENS;

// The two a variant must set: everything else is derived from them, by the
// html[data-theme] rules in app.css.
export const BRAND_TOKENS = ["--brand-primary", "--brand-secondary"] as const;

// The built-in theme, which is no theme at all: app.css's own tokens.
export const DEFAULT_THEME = "seamux";

// A theme's name is its data-theme attribute, so it is kept to what needs
// no escaping anywhere.
export const THEME_NAME = /^[a-z][a-z0-9-]{0,31}$/;
export const MAX_LABEL = 60;

export function isThemeName(name: unknown): name is string {
  return (
    typeof name === "string" && THEME_NAME.test(name) && name !== DEFAULT_THEME
  );
}

// --- Parsed values ---------------------------------------------------------

export type Colour =
  | { space: "hex"; r: number; g: number; b: number; a: number }
  | { space: "rgb"; r: number; g: number; b: number; alpha: number }
  | { space: "hsl"; h: number; s: number; l: number; alpha: number }
  | { space: "oklch"; l: number; c: number; h: number; alpha: number }
  | { space: "oklab"; l: number; a: number; b: number; alpha: number }
  | { space: "transparent" };
export type Length = { unit: "rem" | "px"; value: number };
export type Fraction = { fraction: number };
export type ImageType = (typeof IMAGE_TYPES)[number];
export type Image = { mime: ImageType; base64: string };
export type ThemeValue = Colour | Length | Fraction | Image;
export type Variant = Partial<Record<ThemeToken, ThemeValue>>;
export interface Theme {
  label: string;
  light?: Variant;
  dark?: Variant;
}
export type ColorMode = "light" | "dark";

// The board's theme, and light or dark when a swap last chose one for every
// browser. Each is stamped when it changes, and a browser takes a change
// only when its stamp is newer than the one it already took.
export interface ActiveTheme {
  name: string;
  updatedAt: number;
  color: ColorMode | null;
  colorAt: number;
}

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;

// One argument: a number, with `%` or `deg` where it may have one.
function arg(text: string, percentOf: number | null, deg = false) {
  const m = new RegExp(`^(${NUMBER})(%|deg)?$`, "i").exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2]?.toLowerCase();
  if (unit === "%") return percentOf === null ? null : (n / 100) * percentOf;
  if (unit === "deg") return deg ? n : null;
  return n;
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));
const hue = (n: number) => ((n % 360) + 360) % 360;

// `name(a b c)`, `name(a b c / alpha)`, or the legacy `name(a, b, c[, alpha])`.
function functional(text: string) {
  const m = /^([a-z]+)\(([^()]*)\)$/i.exec(text);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const body = m[2].trim();
  let parts: string[];
  let alpha: string | undefined;
  if (body.includes(",")) {
    parts = body.split(",").map((p) => p.trim());
    if (parts.length === 4) alpha = parts.pop();
  } else {
    const [main, rest, extra] = body.split("/");
    if (extra !== undefined) return null;
    parts = main.trim().split(/\s+/);
    alpha = rest?.trim();
  }
  if (parts.length !== 3) return null;
  return { name, parts, alpha };
}

function parseAlpha(text: string | undefined) {
  if (text === undefined) return 1;
  const a = arg(text, 1);
  return a === null ? null : clamp(a, 0, 1);
}

// A colour as an author may write one, or null. Only these forms: hex,
// rgb()/rgba(), hsl()/hsla(), oklch(), oklab(), and `transparent`.
export function parseColour(input: string): Colour | null {
  const text = input.trim();
  if (/^transparent$/i.test(text)) return { space: "transparent" };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join("");
    const byte = (i: number) => parseInt(digits.slice(i, i + 2), 16);
    return {
      space: "hex",
      r: byte(0),
      g: byte(2),
      b: byte(4),
      a: digits.length === 8 ? byte(6) : 255,
    };
  }
  const fn = functional(text);
  if (!fn) return null;
  const alpha = parseAlpha(fn.alpha);
  if (alpha === null) return null;
  const [p0, p1, p2] = fn.parts;
  if (fn.name === "rgb" || fn.name === "rgba") {
    const [r, g, b] = [p0, p1, p2].map((p) => arg(p, 255));
    if (r === null || g === null || b === null) return null;
    return {
      space: "rgb",
      r: clamp(r, 0, 255),
      g: clamp(g, 0, 255),
      b: clamp(b, 0, 255),
      alpha,
    };
  }
  if (fn.name === "hsl" || fn.name === "hsla") {
    const h = arg(p0, null, true);
    const s = arg(p1, 100);
    const l = arg(p2, 100);
    if (h === null || s === null || l === null) return null;
    return {
      space: "hsl",
      h: hue(h),
      s: clamp(s, 0, 100),
      l: clamp(l, 0, 100),
      alpha,
    };
  }
  if (fn.name === "oklch") {
    const l = arg(p0, 1);
    const c = arg(p1, 0.4);
    const h = arg(p2, null, true);
    if (l === null || c === null || h === null) return null;
    return {
      space: "oklch",
      l: clamp(l, 0, 1),
      c: clamp(c, 0, 0.5),
      h: hue(h),
      alpha,
    };
  }
  if (fn.name === "oklab") {
    const l = arg(p0, 1);
    const a = arg(p1, 0.4);
    const b = arg(p2, 0.4);
    if (l === null || a === null || b === null) return null;
    return {
      space: "oklab",
      l: clamp(l, 0, 1),
      a: clamp(a, -0.5, 0.5),
      b: clamp(b, -0.5, 0.5),
      alpha,
    };
  }
  return null;
}

// A length: 0 to 4rem, or 0 to 64px.
export function parseLength(input: string): Length | null {
  const m = new RegExp(`^(${NUMBER})(rem|px)$`, "i").exec(input.trim());
  if (!m) return null;
  const value = Number(m[1]);
  const unit = m[2].toLowerCase() as Length["unit"];
  if (!Number.isFinite(value) || value < 0) return null;
  if (value > (unit === "rem" ? 4 : 64)) return null;
  return { unit, value };
}

// A fraction from 0 to 1, as a number or a percentage: an opacity.
export function parseFraction(input: string): Fraction | null {
  const n = arg(input.trim(), 1);
  if (n === null || n < 0 || n > 1) return null;
  return { fraction: n };
}

// The images a theme may hold, and how large. An image is kept as its bytes
// and printed back as a data: URL seamux writes itself, so it can never
// name a server (knowledge/themes.md).
export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;
export const MAX_IMAGE_BYTES = 100_000;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// Whether the bytes are what the type says: its signature, or for SVG, text
// that opens an <svg>.
function looksLike(mime: ImageType, bytes: Uint8Array): boolean {
  const at = (i: number, ...xs: number[]) =>
    xs.every((x, j) => bytes[i + j] === x);
  const ascii = (i: number, s: string) =>
    at(i, ...[...s].map((c) => c.charCodeAt(0)));
  switch (mime) {
    case "image/png":
      return at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg":
      return at(0, 0xff, 0xd8, 0xff);
    case "image/gif":
      return ascii(0, "GIF87a") || ascii(0, "GIF89a");
    case "image/webp":
      return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "image/svg+xml": {
      const text = new TextDecoder().decode(bytes.subarray(0, 4096));
      return /^\uFEFF?\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(
        text,
      );
    }
  }
}

// An image as a data: URL, base64 or percent-encoded, of an allowed type,
// whose bytes match it, and no larger than MAX_IMAGE_BYTES. Anything else,
// a URL that names a server among it, is null.
export function parseImage(input: string): Image | null {
  const m = /^data:([a-z0-9.+/-]+)((?:;[a-z0-9-]+=[^;,]*)*)(;base64)?,(.*)$/is.exec(
    input.trim(),
  );
  if (!m) return null;
  const mime = m[1].toLowerCase() as ImageType;
  if (!IMAGE_TYPES.includes(mime)) return null;
  let bytes: Uint8Array;
  try {
    if (m[3]) {
      const text = m[4].replace(/\s+/g, "");
      if (!BASE64.test(text)) return null;
      bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(m[4]));
    }
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
  if (!looksLike(mime, bytes)) return null;
  return { mime, base64: toBase64(bytes) };
}

// --- The schema a theme is saved through ------------------------------------

const MAX_VALUE = 64;

const colourField = z
  .string()
  .max(MAX_VALUE)
  .refine((s) => parseColour(s) !== null, "not a colour")
  .transform((s) => parseColour(s) as Colour);

const lengthField = z
  .string()
  .max(MAX_VALUE)
  .refine((s) => parseLength(s) !== null, "not a length from 0 to 4rem or 64px")
  .transform((s) => parseLength(s) as Length);

const fractionField = z
  .string()
  .max(MAX_VALUE)
  .refine(
    (s) => parseFraction(s) !== null,
    "not a number from 0 to 1, or 0% to 100%",
  )
  .transform((s) => parseFraction(s) as Fraction);

// Base64 of MAX_IMAGE_BYTES, percent-encoded at worst, and the data: prefix.
const MAX_IMAGE_TEXT = MAX_IMAGE_BYTES * 3 + 256;

const imageField = z
  .string()
  .max(MAX_IMAGE_TEXT, `larger than ${MAX_IMAGE_BYTES / 1000} kB`)
  .refine(
    (s) => parseImage(s) !== null,
    `not a data: URL of a PNG, JPEG, WebP, GIF or SVG of at most ${MAX_IMAGE_BYTES / 1000} kB`,
  )
  .transform((s) => parseImage(s) as Image);

const FIELDS = {
  colour: colourField,
  length: lengthField,
  fraction: fractionField,
  image: imageField,
};

const variantShape = Object.fromEntries(
  Object.entries(THEME_TOKENS).map(([token, kind]) => [
    token,
    FIELDS[kind].optional(),
  ]),
) as Record<
  ThemeToken,
  z.ZodOptional<
    | typeof colourField
    | typeof lengthField
    | typeof fractionField
    | typeof imageField
  >
>;

export const variantSchema = z
  .strictObject(variantShape)
  .superRefine((variant, ctx) => {
    for (const token of BRAND_TOKENS) {
      if (!variant[token])
        ctx.addIssue({ code: "custom", path: [token], message: "required" });
    }
  });

export const themeInputSchema = z
  .strictObject({
    label: z.string().trim().min(1, "required").max(MAX_LABEL),
    light: variantSchema.optional(),
    dark: variantSchema.optional(),
  })
  .refine((t) => t.light || t.dark, {
    message: "a theme needs a light variant, a dark one, or both",
  });

// Parses what the editor sent: a label, and each variant as JSON text, ""
// for none. Errors come back one per line, each with where it was.
export function parseThemeInput(input: {
  label: string;
  light: string;
  dark: string;
}): { ok: true; theme: Theme } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const json = (which: "light" | "dark") => {
    const text = input[which].trim();
    if (!text) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch (err) {
      errors.push(`${which}: not JSON (${(err as Error).message})`);
      return undefined;
    }
  };
  const raw = {
    label: input.label,
    light: json("light"),
    dark: json("dark"),
  };
  if (errors.length > 0) return { ok: false, errors };
  const result = themeInputSchema.safeParse(raw);
  if (result.success) return { ok: true, theme: result.data as Theme };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => {
      const where = issue.path.map(String).join(".");
      const message =
        issue.code === "unrecognized_keys"
          ? `not a token a theme can set: ${issue.keys.join(", ")}`
          : issue.message;
      return where ? `${where}: ${message}` : message;
    }),
  };
}

// --- Printing ----------------------------------------------------------------

// A number from the store, within its range, as CSS: at most four decimals,
// never an exponent. null when it isn't a finite number.
function num(value: unknown, lo: number, hi: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return String(Number(clamp(value, lo, hi).toFixed(4)));
}

function hexByte(value: unknown): string | null {
  const n = num(value, 0, 255);
  return n === null ? null : Math.round(Number(n)).toString(16).padStart(2, "0");
}

// A colour or length as CSS, or null when the value isn't one. Checks every
// field, since it may come from a store row written some other way.
export function printValue(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if ("fraction" in v) return num(v.fraction, 0, 1);
  if ("mime" in v) {
    // Written from the stored bytes, never from text: only the type, from
    // the allowlist, and base64's own characters reach the CSS.
    if (!IMAGE_TYPES.includes(v.mime as ImageType)) return null;
    if (typeof v.base64 !== "string" || !BASE64.test(v.base64)) return null;
    if (v.base64.length === 0 || v.base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
      return null;
    return `url("data:${v.mime};base64,${v.base64}")`;
  }
  if ("unit" in v) {
    if (v.unit !== "rem" && v.unit !== "px") return null;
    const n = num(v.value, 0, v.unit === "rem" ? 4 : 64);
    return n === null ? null : `${n}${v.unit}`;
  }
  const alpha = (a: unknown) => {
    const n = num(a, 0, 1);
    return n === null ? null : n === "1" ? "" : ` / ${n}`;
  };
  const three = (
    fn: string,
    xs: [unknown, number, number][],
    a: unknown,
  ): string | null => {
    const parts = xs.map(([x, lo, hi]) => num(x, lo, hi));
    const al = alpha(a);
    if (parts.some((p) => p === null) || al === null) return null;
    return `${fn}(${parts.join(" ")}${al})`;
  };
  switch (v.space) {
    case "transparent":
      return "transparent";
    case "hex": {
      const bytes = [v.r, v.g, v.b, v.a].map(hexByte);
      if (bytes.some((b) => b === null)) return null;
      return `#${bytes.slice(0, 3).join("")}${bytes[3] === "ff" ? "" : bytes[3]}`;
    }
    case "rgb":
      return three(
        "rgb",
        [
          [v.r, 0, 255],
          [v.g, 0, 255],
          [v.b, 0, 255],
        ],
        v.alpha,
      );
    case "hsl": {
      const h = num(v.h, 0, 360);
      const s = num(v.s, 0, 100);
      const l = num(v.l, 0, 100);
      const al = alpha(v.alpha);
      if (h === null || s === null || l === null || al === null) return null;
      return `hsl(${h} ${s}% ${l}%${al})`;
    }
    case "oklch":
      return three(
        "oklch",
        [
          [v.l, 0, 1],
          [v.c, 0, 0.5],
          [v.h, 0, 360],
        ],
        v.alpha,
      );
    case "oklab":
      return three(
        "oklab",
        [
          [v.l, 0, 1],
          [v.a, -0.5, 0.5],
          [v.b, -0.5, 0.5],
        ],
        v.alpha,
      );
    default:
      return null;
  }
}

// A variant's declarations, token by token, leaving out any field that
// isn't an allowed token with a value of its kind.
function declarations(variant: unknown): [ThemeToken, string][] {
  if (!variant || typeof variant !== "object") return [];
  const out: [ThemeToken, string][] = [];
  for (const [token, value] of Object.entries(variant)) {
    if (!Object.hasOwn(THEME_TOKENS, token)) continue;
    const kind = THEME_TOKENS[token as ThemeToken];
    const shape =
      "mime" in Object(value)
        ? "image"
        : "fraction" in Object(value)
          ? "fraction"
          : "unit" in Object(value)
            ? "length"
            : "colour";
    if (shape !== kind) continue;
    const css = printValue(value);
    if (css !== null) out.push([token as ThemeToken, css]);
  }
  return out;
}

// A variant as the editor shows it: JSON of token to CSS value.
export function variantJson(variant: Variant | undefined): string {
  if (!variant) return "";
  return JSON.stringify(Object.fromEntries(declarations(variant)), null, 2);
}

// The variant a theme without one uses: the other variant's brand, from
// which app.css derives the rest.
function brandOf(variant: Variant | undefined): Variant {
  const out: Variant = {};
  for (const token of [...BRAND_TOKENS, "--brand-foreground"] as const) {
    if (variant?.[token]) out[token] = variant[token];
  }
  return out;
}

// One theme's rules. The light rule leaves dark mode out: a light rule
// outranks app.css's .dark tokens (knowledge/themes.md). :root[…] outranks
// app.css's html[data-theme] rules, which derive what a theme leaves out.
export function printTheme(name: string, theme: unknown): string {
  if (!isThemeName(name) || !theme || typeof theme !== "object") return "";
  const t = theme as { light?: unknown; dark?: unknown };
  if (!t.light && !t.dark) return "";
  const light = t.light ?? brandOf(t.dark as Variant);
  const dark = t.dark ?? brandOf(t.light as Variant);
  const block = (selector: string, variant: unknown) =>
    `${selector}{${declarations(variant)
      .map(([token, css]) => `${token}:${css}`)
      .join(";")}}`;
  return [
    block(`:root[data-theme="${name}"]:not(.dark)`, light),
    block(`:root[data-theme="${name}"].dark`, dark),
  ].join("\n");
}

// Every theme's rules, for the page's <head>.
export function printThemes(themes: Record<string, unknown>): string {
  return Object.keys(themes)
    .sort()
    .map((name) => printTheme(name, themes[name]))
    .filter(Boolean)
    .join("\n");
}

// --- Theme files ---------------------------------------------------------------

// A theme as a file to share: its name, label and variants, each variant
// token to CSS value as the editor shows it, under a version that changes
// only when the format does. Tokens are seamux's promise to a theme file: a
// new one may be added, and renaming or removing one is a breaking change.
export const THEME_FILE_VERSION = 1;

export function themeFile(
  name: string,
  theme: { label: string; light: string; dark: string },
): string {
  const variant = (text: string) => (text.trim() ? JSON.parse(text) : undefined);
  return `${JSON.stringify(
    {
      "seamux-theme": THEME_FILE_VERSION,
      name,
      label: theme.label,
      light: variant(theme.light),
      dark: variant(theme.dark),
    },
    null,
    2,
  )}\n`;
}

// A theme file, as the editor's fields for a new theme. Tokens this seamux
// doesn't know, from a newer one or a mistake, are left out and named, so
// the rest of the theme still loads; what's kept is checked when it's saved.
export function readThemeFile(
  text: string,
  fileName: string,
):
  | {
      ok: true;
      name: string;
      label: string;
      light: string;
      dark: string;
      skipped: string[];
    }
  | { ok: false; error: string } {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return { ok: false, error: "not a theme file: not JSON" };
  }
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    return { ok: false, error: "not a theme file" };
  }
  const f = file as Record<string, unknown>;
  const version = f["seamux-theme"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'not a theme file: no "seamux-theme" version' };
  }
  const skipped: string[] = [];
  const variant = (which: "light" | "dark") => {
    const v = f[which];
    if (v === undefined || v === null) return "";
    if (typeof v !== "object" || Array.isArray(v)) {
      skipped.push(which);
      return "";
    }
    const kept: Record<string, string> = {};
    for (const [token, value] of Object.entries(v)) {
      if (Object.hasOwn(THEME_TOKENS, token) && typeof value === "string") {
        kept[token] = value;
      } else {
        skipped.push(`${which}.${token}`);
      }
    }
    return Object.keys(kept).length > 0 ? JSON.stringify(kept, null, 2) : "";
  };
  const fromFileName = fileName
    .replace(/\.json$/i, "")
    .replace(/\.seamux-theme$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, 32);
  const name = isThemeName(f.name) ? f.name : fromFileName;
  const label =
    typeof f.label === "string" ? f.label.slice(0, MAX_LABEL) : name;
  return {
    ok: true,
    name,
    label,
    light: variant("light"),
    dark: variant("dark"),
    skipped,
  };
}

// The colour functions parseColour takes, for the editor to list.
export const COLOUR_FUNCTIONS = ["rgb()", "hsl()", "oklch()", "oklab()"];

// What the Add button starts a theme with.
export const NEW_THEME_LIGHT = `{
  "--brand-primary": "#f5b301",
  "--brand-secondary": "#e0661b"
}`;
