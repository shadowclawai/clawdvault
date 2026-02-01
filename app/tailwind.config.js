/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        vault: {
          dark: '#0a0a0f',
          purple: '#7c3aed',
          gold: '#f59e0b',
        }
      }
    },
  },
  plugins: [],
}
