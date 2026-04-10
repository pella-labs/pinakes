# Testing Internationalization

**i18n testing** ensures your application works correctly across languages, locales, and character sets.

## Translation Completeness

```typescript
import en from '../locales/en.json';
import de from '../locales/de.json';
import ja from '../locales/ja.json';

it('all locales have the same keys', () => {
  const enKeys = Object.keys(en).sort();
  expect(Object.keys(de).sort()).toEqual(enKeys);
  expect(Object.keys(ja).sort()).toEqual(enKeys);
});
```

## Date and Number Formatting

Different locales format dates and numbers differently. Test that your formatters produce correct output:

- US: 1/15/2025, 1,234.56
- Germany: 15.01.2025, 1.234,56
- Japan: 2025/01/15, 1,234.56

## RTL Layout Testing

Right-to-left languages (Arabic, Hebrew) need layout testing. Verify that the UI mirrors correctly and text alignment is proper.

## Unicode Edge Cases

Test with emoji, combining characters, and scripts that have special rendering rules. A name field that breaks on a Japanese surname is a real bug.

## Pseudo-Localization

Replace strings with accented versions to find hardcoded text and layout issues:

"Submit" becomes "[Šüƀɱîţ!!!]"

This exposes untranslated strings without needing actual translations.
