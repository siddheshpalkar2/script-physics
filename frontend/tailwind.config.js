/** @type {import('tailwindcss').Config} */
// Slate & Amber design system (see DESIGN.md). Token names kept from the paper/ledger theme so the JSX reads the same:
// desk = canvas, page = card surface, ink = text, graphite = muted text, ledger = primary navy.
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        desk: "#F1F5F9",
        page: "#FFFFFF",
        ink: "#0F172A",
        graphite: "#64748B",
        ledger: { DEFAULT: "#1E3A8A", dark: "#172554", ring: "#93C5FD" },
        amber: { DEFAULT: "#D97706", soft: "#FEF3C7", deep: "#B45309" },
        line: { DEFAULT: "#E2E8F0", strong: "#CBD5E1" },
        mist: "#F8FAFC",
        slatechip: "#475569",
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        script: ['"Courier Prime"', "Courier", "monospace"],
      },
      boxShadow: {
        // Level 1: cards and panels. Level 2: floating states. Lift: action hover.
        sheet: "0 10px 25px -5px rgba(15,23,42,.05), 0 8px 10px -6px rgba(15,23,42,.03)",
        paper: "0 20px 30px -10px rgba(15,23,42,.08), 0 1px 3px 0 rgba(15,23,42,.04)",
        lift: "0 12px 24px -8px rgba(30,58,138,.28)",
      },
      borderRadius: {
        card: "1rem",
      },
    },
  },
  plugins: [],
};
