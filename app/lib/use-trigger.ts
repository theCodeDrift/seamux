import { useEffect, useRef, useState } from "react";

// Sends text typed to end in the trigger phrase once it has stayed that way
// for the trigger's wait, starting over at every edit. Only typing arms it:
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
    let n = seconds;
    setLeft(n);
    const tick = setInterval(() => {
      n -= 1;
      if (n > 0) return setLeft(n);
      clearInterval(tick);
      setLeft(null);
      fireNow.current();
    }, 1000);
    return () => clearInterval(tick);
  }, [armed, text, seconds]);
  return { left: armed ? left : null, typed: setTyped };
}
