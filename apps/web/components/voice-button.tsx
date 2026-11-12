'use client';

import { Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useFlag } from '@/lib/flags';
import { Button, toast, Tooltip, cx } from './ui';

interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void;
}
type RecognitionCtor = new () => Recognition;
const ctor = (): RecognitionCtor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/**
 * Dictation into a text field using the browser's speech recognition. It only fills in text:
 * nothing is generated or changed until the user presses send/generate and confirms.
 * Hidden when the browser can't do speech recognition or the owner switched voice off.
 */
export function VoiceButton({ onText, size = 'sm', className }: { onText: (text: string) => void; size?: 'xs' | 'sm'; className?: string }) {
  const enabled = useFlag('voice_input');
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  useEffect(() => { setSupported(!!ctor()); }, []);
  useEffect(() => () => rec.current?.stop(), []);
  if (!enabled || !supported) return null;

  const start = () => {
    const C = ctor();
    if (!C) return;
    const r = new C();
    r.lang = navigator.language || 'en-IN';
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i]!.isFinal) text += e.results[i]![0].transcript;
      if (text.trim()) onText(text.trim());
    };
    r.onerror = (e) => {
      setListening(false);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast.error('Microphone access was blocked. Allow it in your browser settings to use voice.');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast.error('Voice input stopped. Try again.');
    };
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };
  const stop = () => { rec.current?.stop(); setListening(false); };

  return (
    <Tooltip content={listening ? 'Stop dictation' : 'Speak instead of typing'}>
      <Button type="button" size={size} variant={listening ? 'accent' : 'ghost'} iconOnly aria-pressed={listening} aria-label={listening ? 'Stop voice input' : 'Start voice input'} onClick={listening ? stop : start} className={cx(listening && 'animate-pulse', className)}>
        {listening ? <Square className="size-3.5" /> : <Mic className="size-4" />}
      </Button>
    </Tooltip>
  );
}
