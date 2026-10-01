"use client";

/**
 * The math answer field. Server render and first paint are the plain mono
 * `<Input>` the Sheet always had; on the client MathLive is loaded lazily
 * and a `<math-field>` takes its place, so fractions draw as fractions and
 * exponents as superscripts while the student types. If MathLive cannot load,
 * the plain input stays and still works (the keypad inserts plain tokens).
 *
 * The contract with the page is a plain string: `value` / `onChange` carry
 * the checker-plain answer (`answer-notation.ts`). The field owns its LaTeX
 * (or, before MathLive loads, its typed text) and only rewrites itself when
 * the incoming `value` is not the last value it emitted: a restore after a
 * failed send, or a cleared field on a new question. The caret never jumps
 * otherwise.
 */

import type { MathfieldElement } from "mathlive";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";

import type { KeypadAction } from "@/components/math/math-keypad";
import { Math as MathFormula } from "@/components/math/math-renderer";
import type { ParsedAnswerPreview } from "@/components/tutor/tutor-client";
import { Input } from "@/components/ui/input";
import {
  evaluateEntry,
  plainToLatex,
  readLatexEntry,
  type AnswerEntry,
} from "@/lib/math/answer-notation";
import { cn } from "@/lib/utils";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "math-field": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & { "math-virtual-keyboard-policy"?: "manual" | "auto" };
    }
  }
}

export type MathAnswerFieldHandle = {
  /** Apply a keypad key to whichever field is live. */
  run: (action: KeypadAction) => void;
  focus: () => void;
  /**
   * Let the OS keyboard come up (true) or keep it down for our keypad
   * (false), then focus the field. Call it from the click that asked for it:
   * phones only raise their keyboard for a focus inside a user gesture.
   */
  setSystemKeyboard: (enabled: boolean) => void;
  /** The live field element (plain input or math-field). */
  element: () => HTMLElement | null;
};

export type MathAnswerFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Everything the field made of the entry, for the "Reads as" preview. */
  onEntry?: (entry: AnswerEntry) => void;
  /** Enter in the field, or the keypad's Check key. */
  onEnter: () => void;
  onFocusChange?: (focused: boolean) => void;
  disabled?: boolean;
  placeholder?: string;
  verdict?: "correct" | "incorrect" | "unreadable" | null;
  describedBy?: string;
  /** Classes for the plain input (height, verdict wash). */
  className?: string;
  /**
   * Our keypad is docked on a touch screen: keep the OS keyboard down.
   * False lets it come up (the student chose "Use keyboard").
   */
  suppressSystemKeyboard?: boolean;
  ref?: Ref<MathAnswerFieldHandle>;
};

type MathliveModule = typeof import("mathlive");

/** One lazy load per page; the promise rejects if the chunk cannot load. */
let mathlivePromise: Promise<MathliveModule> | null = null;

function loadMathlive(): Promise<MathliveModule> {
  if (!mathlivePromise) {
    mathlivePromise = import("mathlive").then((module) => {
      const { MathfieldElement } = module;
      // The KaTeX_* @font-face rules MathLive draws with are already on
      // every page (`katex/dist/katex.min.css` in the root layout, same
      // family names and files), so MathLive must not load a second copy.
      MathfieldElement.fontsDirectory = null;
      MathfieldElement.soundsDirectory = null;
      MathfieldElement.plonkSound = null;
      return module;
    });
    mathlivePromise.catch(() => {
      mathlivePromise = null;
    });
  }
  return mathlivePromise;
}

/**
 * MathLive takes keys through a hidden contenteditable "keyboard sink" that
 * it always marks `inputmode=none`, so the host's `inputMode` alone never
 * raises a phone's keyboard. This sets the sink's mode directly.
 */
function setSinkInputMode(mf: MathfieldElement, suppress: boolean) {
  const sink = mf.shadowRoot?.querySelector(".ML__keyboard-sink");
  sink?.setAttribute("inputmode", suppress ? "none" : "text");
}

function escapeTextLatex(text: string) {
  return text.replace(/[\\{}$&#^_%~]/g, (char) => `\\${char}`);
}

/** Plain-text insertions for each key, used before MathLive loads. */
const PLAIN_INSERT: Partial<Record<KeypadAction, string>> = {
  power: "^",
  square: "^2",
  sqrt: "sqrt(",
  pi: "pi",
  e: "e",
  open: "(",
  close: ")",
  percent: "%",
  factorial: "!",
  binom: "C(",
  plus: "+",
  minus: "-",
  times: "*",
  divide: "/",
};

export function MathAnswerField({
  id,
  value,
  onChange,
  onEntry,
  onEnter,
  onFocusChange,
  disabled,
  placeholder,
  verdict,
  describedBy,
  className,
  suppressSystemKeyboard = false,
  ref,
}: MathAnswerFieldProps) {
  const [ready, setReady] = useState(false);
  // What the plain input shows, tagged with the value it produced. When the
  // page's value moves on without us (restore, clear), the input shows the
  // page's value instead.
  const [draft, setDraft] = useState({ text: value, sent: value });
  const plainText = draft.sent === value ? draft.text : value;

  const inputRef = useRef<HTMLInputElement>(null);
  const mathfieldRef = useRef<MathfieldElement | null>(null);
  const lastEmitted = useRef(value);
  const pendingCaret = useRef<number | null>(null);
  // The plain input had focus when MathLive arrived: hand focus over.
  const handOverFocus = useRef(false);
  const latest = useRef({
    onChange,
    onEntry,
    onEnter,
    onFocusChange,
    disabled,
    suppressSystemKeyboard,
  });
  useEffect(() => {
    latest.current = {
      onChange,
      onEntry,
      onEnter,
      onFocusChange,
      disabled,
      suppressSystemKeyboard,
    };
  });
  // Seed for the math-field when it mounts: what the student typed so far.
  const seed = useRef({ text: plainText, value });
  useEffect(() => {
    seed.current = { text: plainText, value };
  });

  function emit(entry: AnswerEntry) {
    lastEmitted.current = entry.sent;
    latest.current.onEntry?.(entry);
    latest.current.onChange(entry.sent);
  }

  function changePlain(text: string, caret?: number) {
    const entry = evaluateEntry(text);
    setDraft({ text, sent: entry.sent });
    if (caret !== undefined) pendingCaret.current = caret;
    emit(entry);
  }

  // Lazy-load MathLive after first paint. Failure keeps the plain input.
  useEffect(() => {
    let cancelled = false;
    loadMathlive().then(
      () => {
        if (cancelled) return;
        handOverFocus.current =
          document.activeElement !== null &&
          document.activeElement === inputRef.current;
        setReady(true);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Restore the caret after a keypad insertion into the plain input.
  useEffect(() => {
    const input = inputRef.current;
    if (input && pendingCaret.current !== null) {
      input.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  // Wire the math-field once it exists.
  useEffect(() => {
    const mf = mathfieldRef.current;
    if (!ready || !mf) return;

    mf.mathVirtualKeyboardPolicy = "manual";
    mf.menuItems = [];
    mf.popoverPolicy = "off";
    mf.smartFence = true;
    // `*` types a times sign (MathLive's default is a centred dot).
    mf.inlineShortcuts = { ...mf.inlineShortcuts, "*": "\\times" };
    setSinkInputMode(mf, latest.current.suppressSystemKeyboard);

    const { text, value: seededValue } = seed.current;
    mf.value = plainToLatex(text);
    lastEmitted.current = seededValue;
    if (handOverFocus.current) {
      handOverFocus.current = false;
      mf.focus();
      mf.executeCommand("moveToMathfieldEnd");
    }

    const handleInput = () => {
      emit(readLatexEntry(mf.getValue("latex")));
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Enter") return;
      // Submit on Enter only: MathLive's `change` also fires on blur.
      event.preventDefault();
      if (!latest.current.disabled) latest.current.onEnter();
    };
    const handleFocusIn = () => {
      setSinkInputMode(mf, latest.current.suppressSystemKeyboard);
      latest.current.onFocusChange?.(true);
    };
    const handleFocusOut = () => latest.current.onFocusChange?.(false);

    mf.addEventListener("input", handleInput);
    mf.addEventListener("keydown", handleKeyDown, { capture: true });
    mf.addEventListener("focusin", handleFocusIn);
    mf.addEventListener("focusout", handleFocusOut);
    return () => {
      mf.removeEventListener("input", handleInput);
      mf.removeEventListener("keydown", handleKeyDown, { capture: true });
      mf.removeEventListener("focusin", handleFocusIn);
      mf.removeEventListener("focusout", handleFocusOut);
    };
  }, [ready]);

  // A value the field did not emit (restore after a failed send, a new
  // question): rewrite the math-field. Never otherwise, so the caret stays.
  useEffect(() => {
    const mf = mathfieldRef.current;
    if (!ready || !mf || value === lastEmitted.current) return;
    lastEmitted.current = value;
    mf.value = plainToLatex(value);
  }, [ready, value]);

  useEffect(() => {
    const mf = mathfieldRef.current;
    if (!ready || !mf) return;
    setSinkInputMode(mf, suppressSystemKeyboard);
  }, [ready, suppressSystemKeyboard]);

  useEffect(() => {
    const mf = mathfieldRef.current;
    if (!ready || !mf) return;
    mf.disabled = Boolean(disabled);
    mf.placeholder = placeholder
      ? `\\text{${escapeTextLatex(placeholder)}}`
      : "";
  }, [ready, disabled, placeholder]);

  function runMathfield(mf: MathfieldElement, action: KeypadAction) {
    switch (action) {
      case "fraction":
        mf.insert("\\frac{#@}{#?}", { selectionMode: "placeholder" });
        break;
      case "power":
        mf.insert("#@^{#?}", { selectionMode: "placeholder" });
        break;
      case "square":
        mf.insert("#@^{2}", { selectionMode: "after" });
        break;
      case "sqrt":
        mf.insert("\\sqrt{#0}", { selectionMode: "placeholder" });
        break;
      case "binom":
        mf.insert("\\binom{#?}{#?}", { selectionMode: "placeholder" });
        break;
      case "pi":
        mf.insert("\\pi", { selectionMode: "after" });
        break;
      case "e":
        mf.insert("e", { selectionMode: "after" });
        break;
      case "percent":
        mf.insert("\\%", { selectionMode: "after" });
        break;
      case "factorial":
        mf.insert("!", { selectionMode: "after" });
        break;
      case "times":
        mf.insert("\\times", { selectionMode: "after" });
        break;
      case "divide":
        mf.insert("\\div", { selectionMode: "after" });
        break;
      case "plus":
        mf.executeCommand(["typedText", "+"]);
        break;
      case "minus":
        mf.executeCommand(["typedText", "-"]);
        break;
      case "open":
        mf.executeCommand(["typedText", "("]);
        break;
      case "close":
        mf.executeCommand(["typedText", ")"]);
        break;
      case "left":
        mf.executeCommand("moveToPreviousChar");
        break;
      case "right":
        mf.executeCommand("moveToNextChar");
        break;
      case "delete":
        mf.executeCommand("deleteBackward");
        break;
      case "clear":
        mf.executeCommand("deleteAll");
        break;
      default:
        // Digits and the decimal point.
        mf.executeCommand(["typedText", action]);
    }
    emit(readLatexEntry(mf.getValue("latex")));
  }

  function runPlain(input: HTMLInputElement | null, action: KeypadAction) {
    const text = plainText;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? start;
    const selected = text.slice(start, end);
    const replace = (insert: string) =>
      changePlain(
        text.slice(0, start) + insert + text.slice(end),
        start + insert.length,
      );

    switch (action) {
      case "left":
        if (input) {
          const caret = Math.max(0, start - (start === end ? 1 : 0));
          input.setSelectionRange(caret, caret);
        }
        return;
      case "right":
        if (input) {
          const caret = Math.min(text.length, end + (start === end ? 1 : 0));
          input.setSelectionRange(caret, caret);
        }
        return;
      case "delete":
        if (start !== end) replace("");
        else if (start > 0)
          changePlain(text.slice(0, start - 1) + text.slice(end), start - 1);
        return;
      case "clear":
        changePlain("", 0);
        return;
      case "fraction":
        replace(selected ? `(${selected})/` : "/");
        return;
      default:
        replace(PLAIN_INSERT[action] ?? action);
    }
  }

  useImperativeHandle(ref, () => ({
    run(action) {
      if (action === "check") {
        if (!latest.current.disabled) latest.current.onEnter();
        return;
      }
      if (latest.current.disabled) return;
      const mf = mathfieldRef.current;
      if (ready && mf) runMathfield(mf, action);
      else runPlain(inputRef.current, action);
    },
    focus() {
      (mathfieldRef.current ?? inputRef.current)?.focus();
    },
    setSystemKeyboard(enabled) {
      const mf = ready ? mathfieldRef.current : null;
      const input = inputRef.current;
      if (mf) setSinkInputMode(mf, !enabled);
      else if (input) input.inputMode = enabled ? "text" : "none";
      const element: HTMLElement | null = mf ?? input;
      if (!element) return;
      // A field that already has focus keeps the keyboard it had: blur and
      // focus again so the new input mode takes effect.
      const focused = mf ? mf.hasFocus() : document.activeElement === element;
      if (focused) element.blur();
      element.focus();
    },
    element() {
      return mathfieldRef.current ?? inputRef.current;
    },
  }));

  if (ready) {
    return (
      <math-field
        ref={(element) => {
          mathfieldRef.current = element as MathfieldElement | null;
        }}
        id={id}
        data-slot="answer-input"
        data-verdict={verdict ?? undefined}
        math-virtual-keyboard-policy="manual"
        // React sets this as a property on the custom element, where
        // `undefined` would read "undefined"; MathLive's own keyboard sink
        // gets the same mode in `setSinkInputMode`.
        inputMode={suppressSystemKeyboard ? "none" : "text"}
        aria-describedby={describedBy}
        aria-invalid={verdict === "incorrect" ? true : undefined}
        aria-disabled={disabled ? true : undefined}
        className="math-answer-field min-w-0 flex-1"
      />
    );
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!disabled) onEnter();
  };

  return (
    <Input
      ref={inputRef}
      id={id}
      mono
      data-slot="answer-input"
      value={plainText}
      onChange={(event) => changePlain(event.target.value)}
      onKeyDown={handleKeyDown}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
      disabled={disabled}
      placeholder={placeholder}
      autoComplete="off"
      autoCapitalize="off"
      inputMode={suppressSystemKeyboard ? "none" : undefined}
      aria-describedby={describedBy}
      className={className}
      aria-invalid={verdict === "incorrect" ? true : undefined}
    />
  );
}

/** The plain field for word answers and number lists: no keypad, no MathLive. */
export function PlainAnswerField({
  id,
  value,
  onChange,
  onEnter,
  disabled,
  placeholder,
  verdict,
  describedBy,
  className,
}: Omit<MathAnswerFieldProps, "onEntry" | "ref" | "suppressSystemKeyboard">) {
  return (
    <Input
      id={id}
      mono
      data-slot="answer-input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (!disabled) onEnter();
      }}
      disabled={disabled}
      placeholder={placeholder}
      autoComplete="off"
      autoCapitalize="off"
      aria-describedby={describedBy}
      className={cn(className)}
      aria-invalid={verdict === "incorrect" ? true : undefined}
    />
  );
}

/**
 * The line under the field: "Reads as ¼ = 0.25", "Reads as (½)³ = ⅛ ·
 * checked as 1/8" when the field evaluated an expression, or a one-sentence
 * hint ("Use a point for decimals."). Inline `Math` only, so it is valid
 * inside the `<p>`.
 */
export function AnswerReading({ preview }: { preview: ParsedAnswerPreview }) {
  if (preview.hint) {
    return <p className="text-ink">{preview.hint}</p>;
  }
  return (
    <p>
      Reads as <MathFormula>{preview.latex}</MathFormula>
      {preview.checkedAs ? (
        <>
          {" · checked as "}
          <span className="font-mono tabular text-ink">
            {preview.checkedAs}
          </span>
        </>
      ) : null}
    </p>
  );
}
