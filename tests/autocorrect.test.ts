import { describe, expect, it } from 'vitest';
import { correctionFor, DEFAULT_AUTOCORRECT } from '../src/core/autocorrect';

const fix = (line: string, prefs = DEFAULT_AUTOCORRECT, isName?: (w: string) => boolean) => {
  const c = correctionFor(line, 0, prefs, isName);
  return c ? line.slice(0, c.from) + c.insert + line.slice(c.to) : line;
};

describe('autocorrect', () => {
  it('fixes common and theological misspellings, keeping capitals', () => {
    expect(fix('I saw teh')).toBe('I saw the');
    expect(fix('teh')).toBe('The');
    expect(fix('He left. teh')).toBe('He left. The');
    expect(fix('The diciple')).toBe('The disciple');
    expect(fix('Then Teh')).toBe('Then The');
    expect(fix('the Septuigint')).toBe('the Septuagint');
    expect(fix('He said dont')).toBe("He said don't");
  });
  it('capitalises i and sentence starts, but not after abbreviations', () => {
    expect(fix('so i')).toBe('so I');
    expect(fix('he left. then')).toBe('he left. Then');
    expect(fix('then')).toBe('Then');
    expect(fix('- first')).toBe('- First');
    expect(fix('see cf. isa')).toBe('see cf. isa');
  });
  it('fixes TWo INitial capitals', () => {
    expect(fix('THe')).toBe('The');
  });
  it('never touches markup or entity names', () => {
    expect(fix('@teh')).toBe('@teh');
    expect(fix('#teh')).toBe('#teh');
    expect(fix('{born: teh')).toBe('{born: teh');
    expect(fix('I met scouch', DEFAULT_AUTOCORRECT, (w) => w.toLowerCase() === 'scouch')).toBe('I met scouch');
  });
  it('uses your own replacements first, and can be turned off', () => {
    expect(fix('praise jc', { ...DEFAULT_AUTOCORRECT, custom: { jc: 'Jesus Christ' } })).toBe('praise Jesus Christ');
    expect(fix('I saw teh', { ...DEFAULT_AUTOCORRECT, enabled: false })).toBe('I saw teh');
  });
});
