import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Purple theme (design refs: login.jpg / ux.jpg). Values live as CSS
        // variables in globals.css so themes can override tokens without
        // touching components (docs4/19 theming).
        brand: {
          50: 'rgb(var(--cf-brand-50) / <alpha-value>)',
          100: 'rgb(var(--cf-brand-100) / <alpha-value>)',
          200: 'rgb(var(--cf-brand-200) / <alpha-value>)',
          300: 'rgb(var(--cf-brand-300) / <alpha-value>)',
          400: 'rgb(var(--cf-brand-400) / <alpha-value>)',
          500: 'rgb(var(--cf-brand-500) / <alpha-value>)',
          600: 'rgb(var(--cf-brand-600) / <alpha-value>)',
          700: 'rgb(var(--cf-brand-700) / <alpha-value>)',
          800: 'rgb(var(--cf-brand-800) / <alpha-value>)',
          900: 'rgb(var(--cf-brand-900) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
