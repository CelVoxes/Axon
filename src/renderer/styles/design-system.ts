// Design System - Centralized design tokens for consistent UI

export const typography = {
	// Font sizes using a consistent scale
	xs: "10px", // Extra small (captions, metadata)
	sm: "12px", // Small (secondary text, labels)
	base: "14px", // Base (body text, default)
	lg: "16px", // Large (subheadings, important text)
	xl: "18px", // Extra large (headings)
	"2xl": "20px", // 2X large (main headings)
	"3xl": "24px", // 3X large (hero headings)
} as const;

export const spacing = {
	xs: "4px",
	sm: "8px",
	md: "12px",
	lg: "16px",
	xl: "20px",
	"2xl": "24px",
	"3xl": "32px",
} as const;

export const colors = {
	// Primary colors
	primary: {
		50: "#eff6ff",
		500: "#3b82f6",
		600: "#2563eb",
		700: "#1d4ed8",
	},
	// Neutral colors
	gray: {
		50: "#f9fafb",
		100: "#f3f4f6",
		200: "#e5e7eb",
		300: "#d1d5db",
		400: "#9ca3af",
		500: "#6b7280",
		600: "#4b5563",
		700: "#374151",
		800: "#1f2937",
		900: "#111827",
	},
	// Status colors
	success: "#10b981",
	warning: "#f59e0b",
	error: "#ef4444",
	info: "#3b82f6",
} as const;

export const borderRadius = {
	sm: "4px",
	md: "6px",
	lg: "8px",
	xl: "12px",
	full: "9999px",
} as const;

export const shadows = {
	sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
	md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
	lg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
} as const;

// Helper function to get typography values
export const getTypography = (size: keyof typeof typography) =>
	typography[size];
export const getSpacing = (size: keyof typeof spacing) => spacing[size];
export const getColor = (category: keyof typeof colors, shade?: string) => {
	if (
		shade &&
		typeof colors[category] === "object" &&
		colors[category] !== null
	) {
		const colorObj = colors[category] as Record<string, string>;
		return colorObj[shade];
	}
	return colors[category];
};
