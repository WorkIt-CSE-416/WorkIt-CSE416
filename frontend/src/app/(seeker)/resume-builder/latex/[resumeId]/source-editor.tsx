"use client";

import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import CodeMirror, { EditorSelection, EditorView } from "@uiw/react-codemirror";
import { useEffect, useRef } from "react";

/**
 * The Source tab: the LaTeX itself, in CodeMirror with TeX highlighting, for
 * anyone who wants to change what the Words view can't (a link, a layout).
 * Loaded only in the browser (latex-editor.tsx imports it with
 * `ssr: false`): CodeMirror measures the DOM, and nothing here is worth
 * rendering on the server. `jumpTo` moves the cursor to a line the compiler
 * complained about, each time its `at` changes.
 */

const latex = StreamLanguage.define(stex);
const extensions = [latex, EditorView.lineWrapping];

export default function SourceEditor({
  value,
  onChange,
  jumpTo,
}: {
  value: string;
  onChange: (value: string) => void;
  jumpTo: { line: number; at: number } | null;
}) {
  const view = useRef<EditorView | null>(null);

  useEffect(() => {
    const editor = view.current;
    if (!editor || !jumpTo) return;
    const line = editor.state.doc.line(Math.min(Math.max(jumpTo.line, 1), editor.state.doc.lines));
    editor.dispatch({
      selection: EditorSelection.range(line.from, line.to),
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    editor.focus();
  }, [jumpTo]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      onCreateEditor={(editor) => {
        view.current = editor;
      }}
      extensions={extensions}
      basicSetup={{ foldGutter: false, highlightActiveLine: true, autocompletion: false }}
      aria-label="LaTeX source"
      className="border-border-subtle rounded-control overflow-hidden border text-[13px]"
      minHeight="32rem"
      maxHeight="70vh"
    />
  );
}
