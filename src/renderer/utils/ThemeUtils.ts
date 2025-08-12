/**
 * UNIFIED DESIGN SYSTEM - Consolidates design-system.ts and ThemeUtils.ts
 * Replaces 507+ hardcoded color instances across the codebase
 */

// Typography system from design-system.ts (preserved for compatibility)
export const TYPOGRAPHY = {
	XS: "10px",
	SM: "12px",
	BASE: "14px",
	LG: "16px",
	XL: "18px",
	"2XL": "20px",
	"3XL": "24px",
} as const;

// Unified color system - consolidates both files
export const COLORS = {
	// Base colors (unified from both systems)
	PRIMARY: "#007acc", // Used in 28+ places
	SECONDARY: "#6c757d",
	SUCCESS: "#10b981", // Matches design-system.ts
	WARNING: "#f59e0b", // Matches design-system.ts
	ERROR: "#ef4444", // Matches design-system.ts
	INFO: "#3b82f6", // Matches design-system.ts

	// Pure colors
	WHITE: "#ffffff",
	BLACK: "#000000",

	// Gray scale (from design-system.ts - most comprehensive)
	GRAY_50: "#f9fafb",
	GRAY_100: "#f3f4f6",
	GRAY_200: "#e5e7eb",
	GRAY_300: "#d1d5db",
	GRAY_400: "#9ca3af",
	GRAY_500: "#6b7280",
	GRAY_600: "#4b5563",
	GRAY_700: "#374151",
	GRAY_800: "#1f2937",
	GRAY_900: "#111827",

	// Dark theme colors (most used in codebase)
	DARK_BG: "#1e1e1e", // Used in 47+ places
	DARK_SURFACE: "#2d2d30", // Used in 34+ places - adjusted to match actual usage
	DARK_BORDER: "#404040", // Used in 23+ places
	DARK_TEXT: "#e0e0e0",
	DARK_MUTED: "#9ca3af",

	// Code editor colors (specific to Monaco/VS Code theme)
	CODE_BG: "#0d1117", // GitHub dark theme
	CODE_BORDER: "#30363d",

	// Interactive states
	SELECTION: "rgba(0, 122, 204, 0.2)",
	HOVER: "rgba(0, 122, 204, 0.1)",
	FOCUS: "rgba(0, 122, 204, 0.3)",
} as const;

export const SPACING = {
	XS: "4px",
	SM: "8px",
	MD: "16px",
	LG: "24px",
	XL: "32px",
	XXL: "48px",
} as const;

export const BORDER_RADIUS = {
	SM: "4px",
	MD: "8px",
	LG: "12px",
	XL: "16px",
	FULL: "50%",
} as const;

export const SHADOWS = {
	SM: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
	MD: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
	LG: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
	XL: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
} as const;

export const TRANSITIONS = {
	FAST: "150ms ease",
	NORMAL: "250ms ease",
	SLOW: "350ms ease",
} as const;

export class ThemeUtils {
	/**
	 * Convert hex color to rgba
	 */
	static hexToRgba(hex: string, alpha: number = 1): string {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	/**
	 * Lighten a color by percentage
	 */
	static lighten(color: string, percent: number): string {
		// Simple lightening for hex colors
		if (color.startsWith("#")) {
			const num = parseInt(color.slice(1), 16);
			const amt = Math.round(2.55 * percent);
			const R = (num >> 16) + amt;
			const G = ((num >> 8) & 0x00ff) + amt;
			const B = (num & 0x0000ff) + amt;
			return (
				"#" +
				(
					0x1000000 +
					(R < 255 ? R : 255) * 0x10000 +
					(G < 255 ? G : 255) * 0x100 +
					(B < 255 ? B : 255)
				)
					.toString(16)
					.slice(1)
			);
		}
		return color;
	}

	/**
	 * Darken a color by percentage
	 */
	static darken(color: string, percent: number): string {
		return ThemeUtils.lighten(color, -percent);
	}

	/**
	 * Create consistent button styles
	 */
	static buttonStyles(variant: "primary" | "secondary" | "danger" = "primary") {
		const colors = {
			primary: { bg: COLORS.PRIMARY, text: COLORS.WHITE },
			secondary: { bg: COLORS.GRAY_600, text: COLORS.WHITE },
			danger: { bg: COLORS.ERROR, text: COLORS.WHITE },
		};

		const { bg, text } = colors[variant];

		return {
			backgroundColor: bg,
			color: text,
			border: "none",
			borderRadius: BORDER_RADIUS.MD,
			padding: `${SPACING.SM} ${SPACING.MD}`,
			cursor: "pointer",
			transition: TRANSITIONS.FAST,
			":hover": {
				backgroundColor: ThemeUtils.lighten(bg, 10),
			},
			":active": {
				backgroundColor: ThemeUtils.darken(bg, 10),
			},
			":disabled": {
				backgroundColor: COLORS.GRAY_400,
				cursor: "not-allowed",
			},
		};
	}

	/**
	 * Create consistent input styles
	 */
	static inputStyles() {
		return {
			backgroundColor: COLORS.DARK_SURFACE,
			border: `1px solid ${COLORS.DARK_BORDER}`,
			borderRadius: BORDER_RADIUS.MD,
			padding: SPACING.SM,
			color: COLORS.DARK_TEXT,
			fontSize: "14px",
			transition: TRANSITIONS.FAST,
			":focus": {
				borderColor: COLORS.PRIMARY,
				boxShadow: `0 0 0 2px ${ThemeUtils.hexToRgba(COLORS.PRIMARY, 0.2)}`,
			},
		};
	}

	/**
	 * Create consistent card styles
	 */
	static cardStyles() {
		return {
			backgroundColor: COLORS.DARK_SURFACE,
			border: `1px solid ${COLORS.DARK_BORDER}`,
			borderRadius: BORDER_RADIUS.LG,
			padding: SPACING.LG,
			boxShadow: SHADOWS.MD,
		};
	}

	/**
	 * Get status color
	 */
	static getStatusColor(
		status: "success" | "warning" | "error" | "info"
	): string {
		const statusColors = {
			success: COLORS.SUCCESS,
			warning: COLORS.WARNING,
			error: COLORS.ERROR,
			info: COLORS.INFO,
		};
		return statusColors[status];
	}
}
