// The dispatch bar's trigger phrase: a prompt ending in it dispatches on its
// own once it has sat that way for a while, so a dictated prompt can be sent
// by saying so. Safe to import from client and server.

export interface TriggerPhrase {
  // Empty turns it off.
  phrase: string;
  seconds: number;
}

export const DEFAULT_TRIGGER: TriggerPhrase = { phrase: "make it so", seconds: 7 };
export const MAX_TRIGGER_PHRASE = 100;
export const MIN_TRIGGER_SECONDS = 1;
export const MAX_TRIGGER_SECONDS = 60;

const SEPARATOR = String.raw`[\s\p{P}]`;

function words(phrase: string): string[] {
  return phrase.split(new RegExp(`${SEPARATOR}+`, "u")).filter(Boolean);
}

// The prompt without the phrase at its end, or null when it doesn't end in
// it. Case, punctuation and spacing don't count, since dictation adds its
// own: "Fix the build. Make it so." ends in "make it so".
export function stripTrigger(prompt: string, phrase: string): string | null {
  const said = words(phrase);
  if (said.length === 0) return null;
  const escaped = said.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const ending = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escaped.join(`${SEPARATOR}+`)}${SEPARATOR}*$`,
    "iu",
  );
  const match = ending.exec(prompt);
  if (!match) return null;
  return prompt.slice(0, match.index + match[1].length).trimEnd();
}

// A stored value of any shape it has held, or the default.
export function readTrigger(raw: unknown): TriggerPhrase {
  if (!raw || typeof raw !== "object") return DEFAULT_TRIGGER;
  const { phrase, seconds } = raw as Partial<TriggerPhrase>;
  return {
    phrase: typeof phrase === "string" ? phrase : DEFAULT_TRIGGER.phrase,
    seconds:
      typeof seconds === "number" &&
      Number.isInteger(seconds) &&
      seconds >= MIN_TRIGGER_SECONDS &&
      seconds <= MAX_TRIGGER_SECONDS
        ? seconds
        : DEFAULT_TRIGGER.seconds,
  };
}
