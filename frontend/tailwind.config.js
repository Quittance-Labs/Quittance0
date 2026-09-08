/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        stellar: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        // Mirrors the CSS custom properties in `app/globals.css` so the same
        // audited values are reachable from Tailwind utilities.
        ink: '#0f1419',
        paper: '#f4f5f7',
        muted: '#5c6570',
        line: '#d8dce3',
        teal: {
          DEFAULT: '#0f766e',
          hover: '#115e59',
        },
      },
    },
  },
  plugins: [],

  /**
   * Foreground/background pairs this UI actually ships, with the WCAG level each
   * one has to clear (issue #289).
   *
   * axe cannot judge contrast under jsdom, which has no layout and so no
   * computed colours. Declaring the pairs here instead lets
   * `tests/a11y-core-pages.test.js` recompute every ratio from the hex values
   * and fail on a regression, which is the part an automated audit can actually
   * own. `large` marks text rendered at 18.66px bold or 24px and over, where AA
   * is 3:1 rather than 4.5:1.
   *
   * Not consumed by Tailwind itself — it ignores unknown top-level keys.
   */
  a11yContrastPairs: [
    { name: 'body text on paper', fg: '#0f1419', bg: '#f4f5f7', level: 'AA' },
    { name: 'muted text on paper', fg: '#5c6570', bg: '#f4f5f7', level: 'AA' },
    { name: 'muted text on white', fg: '#5c6570', bg: '#ffffff', level: 'AA' },
    { name: 'teal accent on paper', fg: '#0f766e', bg: '#f4f5f7', level: 'AA' },
    { name: 'teal accent on white', fg: '#0f766e', bg: '#ffffff', level: 'AA' },
    { name: 'primary button label', fg: '#ffffff', bg: '#0f766e', level: 'AA' },
    { name: 'primary button label on hover', fg: '#ffffff', bg: '#115e59', level: 'AA' },
    { name: 'disabled button label', fg: '#4a525d', bg: '#e4e7ec', level: 'AA' },
    { name: 'focus ring against paper', fg: '#0f766e', bg: '#f4f5f7', level: 'AA-large' },
    { name: 'paid status text', fg: '#15803d', bg: '#f0fdf4', level: 'AA' },
    { name: 'pending status text', fg: '#854d0e', bg: '#fefce8', level: 'AA' },
    { name: 'expired status text', fg: '#b91c1c', bg: '#fef2f2', level: 'AA' },
    { name: 'cancelled status text', fg: '#4b5563', bg: '#f9fafb', level: 'AA' },
    { name: 'active status filter', fg: '#ffffff', bg: '#0e7490', level: 'AA' },
    { name: 'seller panel label', fg: '#1d4ed8', bg: '#eff6ff', level: 'AA' },
    { name: 'seller panel value', fg: '#1e40af', bg: '#eff6ff', level: 'AA' },
    { name: 'receipt amount', fg: '#15803d', bg: '#f0fdf4', level: 'AA-large' },
  ],
};
