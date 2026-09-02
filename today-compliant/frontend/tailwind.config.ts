import type { Config } from "tailwindcss";

// Brand palette as given by the client — used as-is, not reinterpreted.
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: "#F5E6CC",   // Background / light sections
        blue: "#3F8BC4",    // Primary brand color, buttons, links, CTAs
        brown: "#69483D",   // Secondary/accent sections
        ink: "#000000",     // Headings and main text
        paper: "#FFFFFF",   // Cards, button text, contrast areas
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
