import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/app/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: {
        "2xl": "1280px",
      },
    },
    extend: {
      colors: {
        // ── Editorial showroom palette ───────────────────────────
        // The photographs provide the colour; the UI stays restrained.
        ivory: "hsl(var(--ivory) / <alpha-value>)",
        "warm-cream": "hsl(var(--warm-cream) / <alpha-value>)",
        sand: "hsl(var(--sand) / <alpha-value>)",
        oxblood: {
          DEFAULT: "hsl(var(--oxblood) / <alpha-value>)",
          soft: "hsl(var(--oxblood-soft) / <alpha-value>)",
        },
        "deep-brown": "hsl(var(--deep-brown) / <alpha-value>)",
        "antique-gold": "hsl(var(--antique-gold) / <alpha-value>)",
        line: "hsl(var(--line) / <alpha-value>)",
        // Legacy aliases kept so the existing admin UI + shadcn buttons
        // don't need a sweep. burgundy -> oxblood, gold -> antique-gold.
        gold: {
          DEFAULT: "#A67C44",
          light: "#C29A63",
          dark: "#8A6636",
        },
        burgundy: {
          DEFAULT: "#58202B",
          light: "#77323F",
          dark: "#431821",
        },
        // shadcn/ui tokens
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      fontFamily: {
        serif: ["var(--font-playfair)", "Cormorant Garamond", "Georgia", "serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      aspectRatio: {
        portrait: "4 / 5",
        "portrait-tall": "3 / 4",
        story: "9 / 16",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "overlay-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.5s ease-out",
        "slide-in-right": "slide-in-right 0.32s cubic-bezier(0.22,1,0.36,1)",
        "overlay-in": "overlay-in 0.24s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
