// The dispatch bar's trigger phrase (app/lib/trigger-phrase.ts): what counts
// as a prompt ending in it, and what is sent once it does.

import { expect, it } from "vitest";

import { readTrigger, stripTrigger } from "~/lib/trigger-phrase";

it("takes the phrase off the end of the prompt", () => {
  expect(stripTrigger("Fix the build make it so", "make it so")).toBe(
    "Fix the build",
  );
});

it("ignores case, punctuation and spacing, as dictation writes it", () => {
  expect(stripTrigger("Fix the build. Make it so.", "make it so")).toBe(
    "Fix the build.",
  );
  expect(stripTrigger("Fix it\nMake  it, so!  \n", "make it so")).toBe(
    "Fix it",
  );
  expect(stripTrigger("Ship it. Let’s go", "let's go")).toBe("Ship it.");
});

it("needs the phrase at the very end, as whole words", () => {
  expect(stripTrigger("make it so we can test", "make it so")).toBeNull();
  expect(stripTrigger("remake it so", "make it so")).toBeNull();
  expect(stripTrigger("Fix the build", "make it so")).toBeNull();
});

it("leaves nothing to send when the prompt is only the phrase", () => {
  expect(stripTrigger("Make it so.", "make it so")).toBe("");
});

it("is off with an empty phrase", () => {
  expect(stripTrigger("anything", "")).toBeNull();
  expect(stripTrigger("anything", " . ")).toBeNull();
});

it("treats the phrase as words, not a pattern", () => {
  expect(stripTrigger("Fix it go (now)", "go (now)")).toBe("Fix it");
  expect(stripTrigger("Fix it go now", "g.*")).toBeNull();
});

it("reads the stored setting, falling back to the default", () => {
  expect(readTrigger(null)).toEqual({ phrase: "make it so", seconds: 7 });
  expect(readTrigger({ phrase: "", seconds: 3 })).toEqual({
    phrase: "",
    seconds: 3,
  });
  expect(readTrigger({ phrase: "engage", seconds: 0 })).toEqual({
    phrase: "engage",
    seconds: 7,
  });
});
