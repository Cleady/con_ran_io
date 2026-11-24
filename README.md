# Slither.io — Neon Arena

A high-performance, visually polished **Slither.io** web clone built with **Vite + TypeScript + HTML5 Canvas 2D + Web Audio API** (zero external image/audio dependencies).

## Features
- **Authentic Spine Kinematics**: High-resolution polyline path history with exact arc-length segment resampling (`segmentSpacing`), radius-scaled turn speed, and 1.85× boost with glowing spine wave + tail exhaust orbs.
- **60–144+ FPS Performance**: Uniform 200px `SpatialHashGrid`, strict viewport culling, and startup-cached offscreen sprites (3D-shaded spherical segments, glowing neon orbs, boost auras, hexagonal honeycomb pattern) with zero `ctx.shadowBlur` in the render loop.
- **30 Intelligent AI Bots**: Boundary avoidance, 5-feeler obstacle avoidance, opportunistic death-loot rushes, aggressive cut-off interceptions, and smooth grazing.
- **10 Selectable Skins**: Neon Cyan, Crimson Ember, Toxic Lime, Royal Amethyst, Solar Gold, Classic Rainbow, Cyber Stripe, Sakura Pastel, Ocean Wave, and Ghost White — with live animated lobby preview.
- **Procedural Web Audio**: Synthesized eat pops, boost hum, elimination chimes, and death dissolve with mute toggle.
- **Windows One-Click Launcher**: Double-click `play.bat` to auto-start the server and launch the game in Google Chrome.

## Quick Start

### Windows (One-Click)
Double-click `play.bat` in the project root.

### Command Line
```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

## License

This project is open source and available under the [MIT License](LICENSE).
