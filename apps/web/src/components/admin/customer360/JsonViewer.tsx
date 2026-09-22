"use client";

import { useState } from "react";
import { Button } from "../../ui/Button";

// Pretty-printed, syntax-coloured JSON for Mono's raw records.
//
// Rendered as React text nodes only — never dangerouslySetInnerHTML — because
// this is data from a third party (and, through narrations, from strangers): a
// value containing "<script>" must show up as text, not run.

type Token = { text: string; kind: "key" | "string" | "number" | "boolean" | "null" | "punct" };

const KIND_CLASS: Record<Token["kind"], string> = {
  key: "text-info",
  string: "text-success",
  number: "text-gold-dark",
  boolean: "text-warning",
  null: "text-text-muted italic",
  punct: "text-text-muted",
};

// Strings, numbers, literals and structure. A string followed by ":" is a key.
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],:])/g;

export function tokenizeJson(pretty: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of pretty.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: pretty.slice(last, at), kind: "punct" }); // whitespace/newlines
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        out.push({ text: m[1], kind: "key" }, { text: m[2], kind: "punct" });
      } else out.push({ text: m[1], kind: "string" });
    } else if (m[3] !== undefined) out.push({ text: m[3], kind: "number" });
    else if (m[4] !== undefined) out.push({ text: m[4], kind: "boolean" });
    else if (m[5] !== undefined) out.push({ text: m[5], kind: "null" });
    else out.push({ text: m[6], kind: "punct" });
    last = at + m[0].length;
  }
  if (last < pretty.length) out.push({ text: pretty.slice(last), kind: "punct" });
  return out;
}

/** Largest pretty-printed payload rendered token-by-token; beyond it, plain text. */
const HIGHLIGHT_LIMIT = 200_000;

export function JsonViewer({ value, maxHeight = "28rem" }: { value: unknown; maxHeight?: string }) {
  const [copied, setCopied] = useState(false);
  const pretty = JSON.stringify(value ?? null, null, 2) ?? "null";
  const plain = pretty.length > HIGHLIGHT_LIMIT;

  async function copy() {
    try {
      await navigator.clipboard.writeText(pretty);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard can be blocked; the text is still selectable */
    }
  }

  return (
    <div className="rounded-[var(--radius-sm)] border border-dark-border/60 bg-surface">
      <div className="flex items-center justify-between border-b border-dark-border/60 px-3 py-1.5">
        <span className="text-xs text-text-muted">
          {pretty.split("\n").length.toLocaleString()} lines · {(new Blob([pretty]).size / 1024).toFixed(1)} KB
          {plain && " · too large to colour"}
        </span>
        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre
        className="overflow-auto p-3 font-mono text-xs leading-relaxed text-text-dark"
        style={{ maxHeight }}
        tabIndex={0}
        aria-label="Raw JSON"
      >
        {plain
          ? pretty
          : tokenizeJson(pretty).map((t, i) => (
              <span key={i} className={KIND_CLASS[t.kind]}>
                {t.text}
              </span>
            ))}
      </pre>
    </div>
  );
}
