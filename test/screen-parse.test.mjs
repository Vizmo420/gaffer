import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { levelFromWord, parseScreen, mergeCards, missingFields } from '../web/screen-parse.js';

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/ocr-${n}.json`, import.meta.url), 'utf8')).lines;

test('poziomy ze słów, także z błędami OCR', () => {
  assert.equal(levelFromWord('zadowalajacy'), 6);
  assert.equal(levelFromWord('btyskotliwy'), 11);
  assert.equal(levelFromWord('staby'), 4);
  assert.equal(levelFromWord('swiatowej klasy'), 13);
  assert.equal(levelFromWord('olsniewajacy'), 10);
  assert.equal(levelFromWord('xyzxyz'), null);
});

test('Stojanović: umiejętności, braki cyfr uzupełnione ze słów, cena wywoławcza', () => {
  const r = parseScreen(fx('stojanovic-skills'));
  assert.equal(r.kind, 'cards');
  const c = r.cards[0];
  assert.match(c.name, /Stojanovic/);
  assert.deepEqual([c.form, c.stamina, c.keeper, c.defending, c.playmaking, c.winger, c.passing, c.scoring, c.setPieces], [6, 6, 1, 4, 13, 7, 7, 3, 4]);
});

test('Olofsson: błędna cyfra (6 odczytane jako 9) przegrywa ze słowem', () => {
  const c = parseScreen(fx('olofsson-skills')).cards[0];
  assert.equal(c.winger, 6);
  assert.equal(c.playmaking, 10);
  assert.equal(c.scoring, 5);
  assert.ok(c.warn.some((w) => w.startsWith('winger')));
});

test('Olofsson: strona informacji (TSI, pensja, wiek, lojalność, oferta)', () => {
  const c = parseScreen(fx('olofsson-info')).cards[0];
  assert.match(c.name, /Olofsson/);
  assert.equal(c.age, 28);
  assert.equal(c.tsi, 20850);
  assert.equal(c.salary, 13440);
  assert.equal(c.experience, 4);
  assert.equal(c.leadership, 3);
  assert.equal(c.loyalty, 13);
  assert.equal(c.specialty, 5);
  assert.equal(c.price, 596000);
});

test('dwa zrzuty tego samego zawodnika łączą się w jedną kartę', () => {
  const merged = mergeCards([...parseScreen(fx('olofsson-skills')).cards, ...parseScreen(fx('olofsson-info')).cards]);
  assert.equal(merged.length, 1);
  const c = merged[0];
  assert.equal(c.salary, 13440);
  assert.equal(c.playmaking, 10);
  assert.equal(c.age, 28);
  assert.deepEqual(missingFields(c), []);
});

test('karta z listy wyników: Sakki z ceną i terminem', () => {
  const cards = parseScreen(fx('sakki-card')).cards;
  const s = cards.find((c) => /Sakki/.test(c.name));
  assert.ok(s);
  assert.equal(s.age, 22);
  assert.equal(s.scoring, 11);
  assert.equal(s.passing, 8);
  assert.equal(s.price, 1800000);
  assert.match(s.deadline, /17:06/);
});
