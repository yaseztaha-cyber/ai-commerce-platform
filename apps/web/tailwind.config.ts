/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 900: "#101418", 700: "#2b333b", 500: "#5b6770", 300: "#a7b2ba", 100: "#e6eaed", 50: "#f4f6f7" },
        brand: { 700: "#0e5f4d", 600: "#107a63", 500: "#12916f", 100: "#d9efe7", 50: "#eef7f3" },
        accent: { 600: "#b3541e", 100: "#f7e4d3" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "Segoe UI", "Tahoma", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
