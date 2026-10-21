// Runs before every commit (.husky/pre-commit). Taskless checks the staged
// files against .taskless/rules; a change to a rule tests every rule and
// checks the whole repo with it, since a rule reaches past the files it
// was staged with.
export default {
  "*": (files) => `./.taskless/bin/cli.mjs check ${files.map((f) => JSON.stringify(f)).join(" ")}`,
  ".taskless/rules/**": () => [
    "./.taskless/bin/cli.mjs verify",
    "./.taskless/bin/cli.mjs check",
  ],
};
