import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDelimiter, detectKind, splitBlocks, importText, diffImports } from '../web/csv-import.js';

const SENIOR =
  'Numer na koszulce,Imię i nazwisko,PlayerID,Specjalność,Wychowanek,Wiek,Dni,TSI,Pensja,Doświadczenie,Przywódca,Lojalność,Forma,Kondycja,Bronienie,Defensywa,Rozgrywanie,Dośrodkowania,Podania,Skuteczność,St. fragmenty,Data ostatniego meczu,Ostatnia ocena meczowa,Pozycja w ostatnim meczu\n' +
  '1,Jan Kowalski,101,Szybki,0,27,40,12000,15000,6,5,10,6,7,3,9,7,5,6,4,5,01.11.2026,3.5,ST\n' +
  '9,"Adam Nowak, jr",102,,1,19,3,8000,4000,2,3,20,5,6,1,4,5,3,4,8,3,01.11.2026,4,NP\n';

const YOUTH =
  'Numer na koszulce,Imię i nazwisko,PlayerID,Specjalność,Wiek,Dni,Liczba dni pozostałych do możliwości promowania,Bronienie,Bronienie,Defensywa,Defensywa,Rozgrywanie,Rozgrywanie,Dośrodkowania,Dośrodkowania,Podania,Podania,Skuteczność,Skuteczność,St. fragmenty,St. fragmenty,Data ostatniego meczu,Ostatnia ocena meczowa,Pozycja w ostatnim meczu\n' +
  ',Piotr Mały,201,Techniczny,16,10,30,?,/?,3,/5,4,/6,?,/?,2,/4,?,/?,1,/3,02.11.2026,2.5,PM\n';

test('separator', () => {
  assert.equal(detectDelimiter('a,b,c'), ',');
  assert.equal(detectDelimiter('a;b;c'), ';');
  assert.equal(detectDelimiter('a\tb\tc,d'), '\t');
  assert.equal(detectDelimiter('"x;y",b,c'), ',');
});

test('rozpoznaje seniorów i akademię', () => {
  assert.equal(detectKind(SENIOR), 'senior');
  assert.equal(detectKind(YOUTH), 'youth');
  assert.equal(detectKind('coś zupełnie innego\n1,2'), null);
});

test('wklejka z tabulatorami (np. z arkusza)', () => {
  const tsv = SENIOR.replace(/"Adam Nowak, jr"/, 'Adam Nowak').replaceAll(',', '\t');
  const r = importText(tsv);
  assert.equal(r.senior.players.length, 2);
  assert.equal(r.senior.players[0].playmaking, 7);
  assert.equal(r.youth, null);
});

test('średniki (Excel PL)', () => {
  const r = importText(YOUTH.replaceAll(',', ';'));
  assert.equal(r.youth.players.length, 1);
  assert.equal(r.youth.players[0].playmakingMax, 6);
  assert.equal(r.youth.players[0].keeper, -1);
});

test('oba składy w jednym wklejeniu', () => {
  const blocks = splitBlocks(SENIOR + '\n\n' + YOUTH);
  assert.equal(blocks.length, 2);
  const r = importText(YOUTH + '\n' + SENIOR);
  assert.equal(r.senior.players.length, 2);
  assert.equal(r.youth.players.length, 1);
  assert.equal(r.youth.players[0].isYouth, true);
});

test('remis nagłówków rozstrzyga wiek', () => {
  const minimal = (age) => `Imię i nazwisko,PlayerID,Wiek,Rozgrywanie\nA B,1,${age},5\n`;
  assert.equal(detectKind(minimal(16)), 'youth');
  assert.equal(detectKind(minimal(25)), 'senior');
});

test('różnica importów', () => {
  const a = importText(SENIOR).senior;
  const b = structuredClone(a);
  b.players[0].playmaking = 8;
  b.players.pop();
  b.players.push({ ...a.players[0], id: 999, firstName: 'Nowy', lastName: 'Gość' });
  const d = diffImports({ ...a, importedAt: 'x' }, { ...b, importedAt: 'y' });
  assert.equal(d.enough, true);
  assert.deepEqual(d.changed[0].deltas, [{ skill: 'RO', from: 7, to: 8, diff: 1 }]);
  assert.equal(d.removed[0].name, 'Adam Nowak, jr');
  assert.equal(d.added[0].name, 'Nowy Gość');
  assert.equal(diffImports(null, b).enough, false);
});
