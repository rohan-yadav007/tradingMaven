
const colors = require('tailwindcss/colors');

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./App.tsx",
    "./index.tsx",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./services/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Use slate for a softer, more professional feel than gray
        slate: colors.slate,
        // Primary action color
        sky: colors.sky,
        // Success/Profit color
        emerald: colors.emerald,
        // Danger/Loss color
        rose: colors.rose,
        // Warning color
        amber: colors.amber,
      }
    },
  },
  plugins: [],
}