import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brick: {
          red: '#B40000',
          yellow: '#FFD500',
          blue: '#0055BF',
          green: '#00852B',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          alt: '#F9F8F5',
          bg: '#F7F6F2',
          viewer: '#F0EFE9',
        },
        border: {
          DEFAULT: '#E8E7E2',
          subtle: '#EEEEEE',
          input: '#DDDDDD',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '14px',
        button: '12px',
        'button-sm': '8px',
        item: '10px',
        pill: '20px',
        swatch: '4px',
      },
      boxShadow: {
        card: '0 2px 8px rgba(0, 0, 0, 0.04)',
        'card-hover': '0 8px 24px rgba(0, 0, 0, 0.12)',
        toggle: '0 4px 20px rgba(0, 0, 0, 0.08)',
        'toggle-active': '0 2px 8px rgba(180, 0, 0, 0.3)',
        swatch: 'inset 0 -1px 2px rgba(0, 0, 0, 0.12)',
        stud: 'inset 0 -2px 4px rgba(0, 0, 0, 0.2), 0 1px 2px rgba(0, 0, 0, 0.15)',
      },
    },
  },
  plugins: [],
};

export default config;
