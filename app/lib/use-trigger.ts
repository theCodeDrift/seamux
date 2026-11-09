import { useEffect, useRef, useState } from "react";

// How long the text must sit unchanged, ending in the phrase, before the
// count starts. Typing goes on past the phrase ("make it so that...")
// within it, so typing the words never starts the count or closes a full
// view mid-sentence; dictation lands the phrase and stops, so it starts
// soon after. Typing can't be told from dictation reliably: some
// dictation tools send keystrokes as typing does.
export const SETTLE_MS = 750;

// Sends text typed to end in the trigger phrase once it has gone quiet
// (SETTLE_MS) and then stayed that way for the trigger's wait, starting
// over at every edit. Only typing arms it:
// text put back after a failure or a reload, or moved in from elsewhere,
// waits to be sent by hand. Each input calls `typed` with what it typed;
// `left` is the seconds to go, or null.
export function useTrigger({
  text,
  outgoing,
  seconds,
  ready,
  fire,
}: {
  text: string;
  // The text without the phrase (stripTrigger), or the text when it
  // doesn't end in it.
  outgoing: string;
  seconds: number;
  // Whether it could be sent now, and from a box someone is using.
  ready: boolean;
  fire: () => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  // Forgotten once the text is anything else, as when it is sent: a failed
  // send that puts the same text back doesn't send it again.
  useEffect(() => {
    if (typed !== null && typed !== text) setTyped(null);
  }, [typed, text]);
  const armed =
    ready && typed === text && outgoing !== text && outgoing.trim() !== "";
  const [left, setLeft] = useState<number | null>(null);
  const fireNow = useRef(fire);
  fireNow.current = fire;
  useEffect(() => {
    if (!armed) {
      setLeft(null);
      return;
    }
    setLeft(null);
    let n = seconds;
    let tick: ReturnType<typeof setInterval> | undefined;
    const settle = setTimeout(() => {
      setLeft(n);
      tick = setInterval(() => {
        n -= 1;
        if (n > 0) return setLeft(n);
        clearInterval(tick);
        setLeft(null);
        fireNow.current();
      }, 1000);
    }, SETTLE_MS);
    return () => {
      clearTimeout(settle);
      clearInterval(tick);
    };
  }, [armed, text, seconds]);
  return { left: armed ? left : null, typed: setTyped };
}
