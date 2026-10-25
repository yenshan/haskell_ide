import { StreamLanguage } from '@codemirror/language';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';

export const haskellLanguage = StreamLanguage.define({
  ...haskell,
  token(stream,state) {
    const token = haskell.token(stream,state);
    const word = stream.current();
    // The legacy mode groups built-in functions, types, and operators together.
    // Split those existing tokens so themes can give each category its own color.
    if (token === 'builtin' || token === 'keyword' || token === 'variable') {
      if (/^[-!#$%&*+.\/<=>?@\\^|~:]+$/.test(word)) return 'operator';
      if (token === 'builtin' && /^[A-Z]/.test(word)) return 'type';
    }
    return token;
  }
});
