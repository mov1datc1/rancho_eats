import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: '#2D8B7A',
        'brand-dark': '#1E6B5A',
        'brand-light': '#7EC8BB',
        earth: '#4A7C6F',
        cream: '#F2FAF7',
        dark: '#0F2F28',
        mid: '#1B4A3F',
        muted: '#6B918A',
        green: '#2D6A4F',
        amber: '#E07B30'
      },
      fontFamily: {
        display: ['"Playfair Display"', 'serif'],
        body: ['Outfit', 'sans-serif']
      },
      boxShadow: {
        card: '0 4px 24px rgba(26,13,6,.10)',
        'card-lg': '0 16px 48px rgba(26,13,6,.18)'
      }
    }
  },
  plugins: []
};

export default config;
