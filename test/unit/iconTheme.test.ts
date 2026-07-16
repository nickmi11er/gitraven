import { describe, expect, it } from 'vitest';
import { decodeFontCharacter, matchDefIds, parseIconTheme } from '../../src/extension/icons/iconThemeModel';
import type { LanguageIndex, RawIconTheme } from '../../src/extension/icons/iconThemeModel';

const theme: RawIconTheme = {
  iconDefinitions: {
    _file: {},
    _ts: {},
    _spec: {},
    _pkg: {},
    _yaml: {},
    _ts_light: {},
  },
  file: '_file',
  fileExtensions: { ts: '_ts', 'spec.ts': '_spec' },
  fileNames: { 'package.json': '_pkg' },
  languageIds: { yaml: '_yaml' },
  light: { fileExtensions: { ts: '_ts_light' } },
};

const lang: LanguageIndex = {
  byExtension: new Map([['yml', 'yaml']]),
  byFileName: new Map(),
};

describe('icon theme matching', () => {
  it('prefers full file names over extensions', () => {
    expect(matchDefIds(theme, 'package.json', lang).main).toBe('_pkg');
  });

  it('prefers the longest multi-dot extension', () => {
    expect(matchDefIds(theme, 'foo.spec.ts', lang).main).toBe('_spec');
    expect(matchDefIds(theme, 'foo.ts', lang).main).toBe('_ts');
  });

  it('matches case-insensitively', () => {
    expect(matchDefIds(theme, 'Foo.TS', lang).main).toBe('_ts');
  });

  it('falls back to the language id, then the file default', () => {
    expect(matchDefIds(theme, 'ci.yml', lang).main).toBe('_yaml');
    expect(matchDefIds(theme, 'LICENSE', lang).main).toBe('_file');
  });

  it('resolves the light variant from the light section, else the main match', () => {
    expect(matchDefIds(theme, 'foo.ts', lang).light).toBe('_ts_light');
    expect(matchDefIds(theme, 'package.json', lang).light).toBe('_pkg');
  });

  it('parses JSONC theme documents (comments, trailing commas)', () => {
    const parsed = parseIconTheme(`{
      // a comment with a "quote
      "file": "_file", /* block */
      "fileExtensions": { "ts": "_ts", },
    }`);
    expect(parsed.file).toBe('_file');
    expect(parsed.fileExtensions).toEqual({ ts: '_ts' });
  });

  it('keeps comment-looking content inside strings intact', () => {
    const parsed = parseIconTheme('{ "fileNames": { "a//b": "_file" } }');
    expect(parsed.fileNames).toEqual({ 'a//b': '_file' });
  });

  it('decodes CSS-escaped font characters', () => {
    expect(decodeFontCharacter('\\E060')).toBe('\uE060');
    expect(decodeFontCharacter('\\E001 ')).toBe('\uE001');
    expect(decodeFontCharacter('\\1F4A9')).toBe('\u{1F4A9}');
    expect(decodeFontCharacter('A')).toBe('A');
    expect(decodeFontCharacter('\\\\')).toBe('\\');
  });
});
