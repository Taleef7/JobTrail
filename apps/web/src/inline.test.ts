import { describe, expect, it } from "vitest";
import { inlineTokens } from "./inline";

describe("inlineTokens", () => {
  it("returns plain text as a single token", () => {
    expect(inlineTokens("plain text")).toEqual([{ kind: "text", value: "plain text" }]);
  });

  it("splits inline code spans", () => {
    expect(inlineTokens("use `pnpm` here")).toEqual([
      { kind: "text", value: "use " },
      { kind: "code", value: "pnpm" },
      { kind: "text", value: " here" },
    ]);
  });

  it("links issue references outside code", () => {
    expect(inlineTokens("done (#63).")).toEqual([
      { kind: "text", value: "done (" },
      { kind: "issue", value: "#63", number: 63 },
      { kind: "text", value: ")." },
    ]);
  });

  it("does not link issue references inside code spans", () => {
    expect(inlineTokens("`Refs #N` and `#12`")).toEqual([
      { kind: "code", value: "Refs #N" },
      { kind: "text", value: " and " },
      { kind: "code", value: "#12" },
    ]);
  });

  it("leaves an unmatched backtick as text", () => {
    expect(inlineTokens("a ` b")).toEqual([{ kind: "text", value: "a ` b" }]);
  });
});
