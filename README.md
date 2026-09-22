# Synara voice waveform width regression

Visual evidence for the responsive recorder waveform fix, based on upstream commit `f04341a`.

The screenshots render the actual original and changed `ComposerVoiceRecorderBar` components with the same 160 deterministic synthetic waveform samples, in Chromium on Windows. The recording fixture is 1200 CSS pixels wide and screenshots use a device scale factor of 2. No microphone or provider request is used in this replay.

- [Before](before.png): fixed 2px bars and 2px gaps cap the waveform at 638 CSS pixels.
- [After](after.png): spacing adapts to the measured track width once the retained sample buffer is full.
- [Resize video](resize.mp4): the same component fixtures at 1200, 1600, 800, 500 and 1200 CSS pixels.
- [Geometry results](geometry.json): 12 passing checks across fixture widths 400, 500, 1200 and 2400 CSS pixels and device scale factors 1, 1.5 and 2.

Validation with Bun 1.4.2 and Node.js 24.13.1:

- `bun run fmt:check`: pass (checkout normalized to LF after Windows Git initially produced CRLF).
- `bun run lint`: pass, 0 errors; 727 informational repository warnings.
- `bun run typecheck`: all 7 workspace tasks pass.
- `bun run --cwd apps/web test:browser src/components/chat/ComposerVoiceRecorderBar.browser.tsx src/lib/voiceRecorder.browser.tsx`: 7 tests pass.
- `bun run test:web:focused src/lib/voiceRecorderEncoding.test.ts src/components/chat/useComposerVoiceController.test.ts`: 20 tests pass.

The new wide-layout and resize regression tests failed against the original component and pass with the fix. The installed Synara 0.9.0 desktop app was not replaced or rebuilt; visual validation uses the source component in Chromium.
