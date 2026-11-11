#!/usr/bin/env python3
"""OCR jednego zrzutu ekranu -> JSON {lines:[{x,y,w,h,conf,text}]} na stdout.
Uruchamiane przez serve-web.js (/api/ocr) w środowisku .ocr-venv (RapidOCR, lokalnie, bez AI)."""
import json, sys
from rapidocr_onnxruntime import RapidOCR

res, _ = RapidOCR()(sys.argv[1])
lines = []
for box, text, conf in (res or []):
    xs = [p[0] for p in box]; ys = [p[1] for p in box]
    lines.append({'x': int(sum(xs) / 4), 'y': int(sum(ys) / 4), 'w': int(max(xs) - min(xs)), 'h': int(max(ys) - min(ys)),
                  'conf': round(float(conf), 2), 'text': text})
json.dump({'lines': lines}, sys.stdout, ensure_ascii=False)
