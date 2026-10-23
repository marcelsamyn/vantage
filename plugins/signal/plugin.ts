import { definePlugin } from "../../app/core/plugin";
import { glyph } from "./glyph";

export default definePlugin({
  id: "signal",
  name: "Signal",
  description: "A spectrogram, sound level meter, tuner and ultrasonic beacon watch for the sound around you.",
  contributes: {
    screen: {
      title: "Signal",
      summary: "See the sound around you",
      glyph,
      section: "signals",
      order: 20,
      hotkey: "5",
      view: () => import("./Screen"),
    },
    commands: [
      { id: "signal.level", title: "Measure sound level", hint: "Loudness in dBFS and approximate dB SPL", keywords: ["noise", "decibel", "loudness", "microphone", "meter"], intent: { action: "level" } },
      { id: "signal.beacons", title: "Check for ultrasonic beacons", hint: "Listen for tones above 17.5 kHz", keywords: ["ultrasonic", "beacon", "tracking", "ads", "microphone"], intent: { action: "beacons" } },
      { id: "signal.tuner", title: "Tune an instrument", hint: "Note, octave and cents from the microphone", keywords: ["pitch", "guitar", "note", "tuner", "microphone"], intent: { action: "tuner" } },
    ],
  },
});
