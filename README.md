# Sparkbench

A circuit playground with a real simulator underneath — draw a circuit, watch it come alive.

Built to learn electronics from first principles: the physics is genuinely modelled, not faked.

## What's actually simulated

- **Modified nodal analysis** solved every animation frame (Gaussian elimination with partial pivoting)
- **LEDs** as piecewise-linear diodes — they need their forward voltage (red 1.8 V / green 2.1 / blue 2.8) before they conduct, then current climbs steeply. Push past ~30 mA and they really do blow.
- **NPN transistors** with the 0.65 V base–emitter doorstep, β = 100 in the active region, and genuine saturation when the collector circuit can't supply β × I_B
- **Capacitors** via backward-Euler companion models, so charge and discharge follow real RC curves
- **LDRs** from 500 Ω in bright light to 200 kΩ in the dark, driven by a room-light slider
- **Buzzers** that actually sound through Web Audio, volume tracking current, silent when wired backwards

## The learning panel

- **Kirchhoff's loop** — every part's share of the battery voltage, listed in order, summing back to the supply
- **Live formulas** with your real numbers substituted (Ohm's law, Q = CV, ½CV², I_C = β × I_B)
- **Plain-English diagnostics**, each with its evidence and one suggested fix — reversed LED, no series resistor, floating transistor base, open switch, incomplete loop, short circuit
- **Datasheets** per component, written in first-principles language

## Using it

- Tap a part in the palette then tap the board, or drag it straight in (on a phone, drag *up* out of the dock; swipe sideways to scroll the palette)
- Drop a part onto a wire to splice it into the circuit
- Tap two terminal dots to wire them; hollow dots mean not yet connected
- Drag the empty board to pan, scroll or pinch-zoom, ⌂ frames the circuit
- Autosaves to local storage

## Develop

```bash
npm install
npm run dev -- --host   # the printed Network URL opens on your phone over wifi
```

## Deploy

Push to `main`. GitHub Actions builds and publishes to Pages — set **Settings → Pages → Source** to **GitHub Actions** once, and nothing else is needed. The build artifact is never committed to the repo.
