var config = {
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            colors: {
                brand: '#2D8B7A',
                'brand-dark': '#1F6B5C',
                'brand-light': '#7DD4C0',
                earth: '#1A5C4F',
                cream: '#F0FAF7',
                dark: '#0D2B26',
                mid: '#1B4D44',
                muted: '#6B8F88',
                green: '#2D6A4F',
                amber: '#E07B30'
            },
            fontFamily: {
                display: ['"Playfair Display"', 'serif'],
                body: ['Outfit', 'sans-serif']
            },
            boxShadow: {
                card: '0 4px 24px rgba(13,43,38,.10)',
                'card-lg': '0 16px 48px rgba(13,43,38,.18)'
            }
        }
    },
    plugins: []
};
export default config;
