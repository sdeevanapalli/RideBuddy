module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#fc4c02', // Strava orange
          hover: '#e34402',
        },
        dark: {
          DEFAULT: '#1a1a1a',
        }
      }
    },
  },
  plugins: [],
}
