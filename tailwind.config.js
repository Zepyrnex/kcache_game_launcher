
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {

        surface: {
          950: "#08070d",
          900: "#0e0c17",
          800: "#16132a",
          700: "#1e1a38",
          600: "#252042",
        },

        accent: {
          50:  "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
          900: "#4c1d95",
        },

        success: "#22c55e",
        warning: "#f59e0b",
        danger:  "#ef4444",
        info:    "#3b82f6",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      backgroundImage: {
        "gradient-accent": "linear-gradient(135deg, #7c3aed 0%, #3b82f6 100%)",
        "gradient-surface": "linear-gradient(180deg, #0e0c17 0%, #08070d 100%)",
        "gradient-card": "linear-gradient(135deg, #16132a 0%, #0e0c17 100%)",
      },
      boxShadow: {
        "glow-accent": "0 0 20px rgba(124, 58, 237, 0.4)",
        "glow-sm":     "0 0 10px rgba(124, 58, 237, 0.25)",
        "card":        "0 4px 24px rgba(0, 0, 0, 0.4)",
        "card-hover":  "0 8px 40px rgba(0, 0, 0, 0.6)",
      },
      animation: {
        "fade-in":      "fadeIn 0.3s ease-out",
        "slide-up":     "slideUp 0.3s ease-out",
        "pulse-accent": "pulseAccent 2s ease-in-out infinite",
        "shimmer":      "shimmer 1.5s linear infinite",
      },
      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%":   { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseAccent: {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.6" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
};
