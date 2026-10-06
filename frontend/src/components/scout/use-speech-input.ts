"use client";

import { useRef, useState, useSyncExternalStore } from "react";

/**
 * The composer's mic: the browser's own speech recognition, so dictation costs
 * nothing and no audio reaches our servers. Chrome, Edge and Safari have it
 * (Chrome and Edge recognise speech on their vendor's servers); Firefox does
 * not, and there the mic is simply not shown.
 *
 * TypeScript's DOM library does not declare the Web Speech API, so the little
 * of it used here is typed by hand.
 */

type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | undefined {
  const w = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

// Support never changes while the page is open, so there is nothing to
// subscribe to; useSyncExternalStore is here for its server snapshot, which
// renders the mic hidden and lets the client reveal it without a mismatch.
const noSubscription = () => () => {};

export function useSpeechInput(onText: (text: string) => void) {
  const supported = useSyncExternalStore(
    noSubscription,
    () => recognitionConstructor() !== undefined,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const active = useRef<Recognition | null>(null);

  function toggle() {
    if (active.current) {
      active.current.stop();
      return;
    }
    const Recognition = recognitionConstructor();
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.lang = navigator.language;
    recognition.interimResults = false;
    recognition.onresult = (event) =>
      onText(Array.from(event.results, (result) => result[0].transcript).join(" "));
    recognition.onend = () => {
      active.current = null;
      setListening(false);
    };
    active.current = recognition;
    recognition.start();
    setListening(true);
  }

  return { supported, listening, toggle };
}
