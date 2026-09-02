import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  { ignores: ['.next/**', 'node_modules/**'] },
  // `next/core-web-vitals` still ships as an eslintrc-style config, so it is
  // bridged into flat config rather than rewritten.
  ...compat.extends('next/core-web-vitals'),
  {
    rules: {
      // The mail UI renders user-authored text; `no-unescaped-entities` fires on
      // ordinary apostrophes in copy, which are already escaped where needed.
      'react/no-unescaped-entities': 'off',
    },
  },
];
