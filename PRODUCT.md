# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
One manager (Vizmo) running the Hattrick club Portowcy FC (VI.139, Poland), plus its youth academy. Uses Gaffer mostly on an iPhone over home Wi-Fi (app served from a Raspberry Pi at http://192.168.1.79:5173), occasionally on a computer. Typical moments: after the weekly training update, before a match (pick lineup vs a known opponent), when deciding promotions/transfers.

## Product Purpose
A personal assistant that turns the club's squad data into decisions: best lineup per formation, training projections, squad/economy analysis, academy planning, and an AI advisor that writes a weekly plan. Success = the manager knows what lineup to set, whom to train, promote, sell, in under a few minutes, on a phone.

## Positioning
Open-source (MIT) Gaffer, runs locally for one team. No CHPP licence: data arrives as Hattrick CSV exports, pasted text, or data files transcribed from screenshots. The AI advisor goes through the owner's own local gateway (OmniRoute → Gemini), free.

## Operating Context
- Data in: CSV import / paste / drag & drop (senior vs youth auto-detected), or data/*.json on the Pi (squad, youth, changes, club.json with training/staff/finance/league/next opponent).
- Decisions out: the manager enters lineup/training in Hattrick by hand. Gaffer never logs into hattrick.org and never writes to the game (ToS).
- Language: Polish UI. Hattrick vocabulary (pozycje, umiejętności, poziomy 0–20, Krzepa Zespołu, Supporter).

## Capabilities and Constraints
- Vanilla JS modules in web/ (no framework, no build), single-file standalone build via scripts/build-standalone.mjs, served by scripts/serve-web.js (also /api/ai, /api/ai/history).
- All existing tabs stay (owner decision 2026-11-05): Doradca AI, Optymalizator, Trening, Zawodnicy, Mapa umiejętności, Mapa ocen, Ekonomia, Transfery, Historia, Mecze, Kronika Klubu, Akademia. Kronika and market scanner need CHPP and are mostly empty.
- Ratings are community approximations; must be labelled as such.

## Evidence on Hand
Real squad data for Portowcy FC in data/ (gitignored). No testimonials, users, or metrics beyond the owner.

## Product Principles
1. Decision first: each view leads with the recommendation, details below.
2. Phone first: one-thumb use, readable without zoom.
3. Honest numbers: approximations labelled, unknown skills shown as unknown, AI is advice not truth.
4. Local and private: data stays on the Pi/browser; only the AI summary goes to the owner's gateway.
