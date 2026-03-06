import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: '#C8410B',
        'brand-dark': '#8B2D07',
        'brand-light': '#F4A261',
        earth: '#6B4226',
        cream: '#FDF6EC',
        dark: '#1A0D06',
        mid: '#3D2314',
        muted: '#8C6A5A',
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
