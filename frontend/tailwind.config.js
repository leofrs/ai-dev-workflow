const themeColor = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: themeColor('canvas'),
        panel: themeColor('panel'),
        surface: {
          DEFAULT: themeColor('surface'),
          muted: themeColor('surface-muted'),
          strong: themeColor('surface-strong')
        },
        line: {
          DEFAULT: themeColor('line'),
          strong: themeColor('line-strong')
        },
        foreground: {
          DEFAULT: themeColor('foreground'),
          secondary: themeColor('foreground-secondary'),
          tertiary: themeColor('foreground-tertiary'),
          subtle: themeColor('foreground-subtle'),
          muted: themeColor('foreground-muted'),
          faint: themeColor('foreground-faint')
        },
        primary: {
          DEFAULT: themeColor('primary'),
          hover: themeColor('primary-hover')
        },
        accent: {
          DEFAULT: themeColor('accent'),
          strong: themeColor('accent-strong'),
          line: themeColor('accent-line')
        },
        warning: {
          DEFAULT: themeColor('warning'),
          strong: themeColor('warning-strong')
        },
        danger: {
          DEFAULT: themeColor('danger'),
          strong: themeColor('danger-strong'),
          surface: themeColor('danger-surface'),
          line: themeColor('danger-line')
        },
        info: themeColor('info'),
        testing: themeColor('testing'),
        review: themeColor('review'),
        overlay: themeColor('overlay')
      }
    }
  },
  plugins: []
};
