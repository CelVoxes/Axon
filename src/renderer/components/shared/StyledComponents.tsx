import styled, { css } from "styled-components";
import { typography } from "../../styles/design-system";
import { COLORS, SPACING, BORDER_RADIUS, SHADOWS, TRANSITIONS } from "../../utils/ThemeUtils";

// Shared ActionButton with variants
export const ActionButton = styled.button<{
	$variant?: "primary" | "secondary" | "icon" | "success" | "danger";
	$size?: "small" | "medium" | "large";
}>`
	background: ${(props) => {
		switch (props.$variant) {
			case "primary":
				return COLORS.PRIMARY;
			case "secondary":
				return COLORS.DARK_SURFACE;
			case "success":
				return COLORS.SUCCESS;
			case "danger":
				return COLORS.ERROR;
			case "icon":
			default:
				return "transparent";
		}
	}};
	border: ${(props) => {
		switch (props.$variant) {
			case "primary":
			case "secondary":
			case "success":
			case "danger":
				return `1px solid ${COLORS.DARK_BORDER}`;
			case "icon":
			default:
				return "none";
		}
	}};
	color: ${(props) => {
		switch (props.$variant) {
			case "primary":
				return COLORS.WHITE;
			case "secondary":
			case "icon":
			default:
				return COLORS.DARK_TEXT;
		}
	}};
	cursor: pointer;
	padding: ${(props) => {
		switch (props.$size) {
			case "small":
				return "2px 6px";
			case "large":
				return "8px 16px";
			case "medium":
			default:
				return "6px 12px";
		}
	}};
	border-radius: ${(props) => {
		switch (props.$variant) {
			case "icon":
				return "2px";
			default:
				return "4px";
		}
	}};
	font-size: ${(props) => {
		switch (props.$size) {
			case "small":
				return typography.xs;
			case "large":
				return typography.base;
			case "medium":
			default:
				return typography.sm;
		}
	}};
	display: flex;
	align-items: center;
	gap: 6px;
	transition: all 0.2s ease;

	&:hover {
		background: ${(props) => {
			switch (props.$variant) {
				case "primary":
					return "#005a9e";
				case "secondary":
					return "#404040";
				case "success":
					return "#218838";
				case "danger":
					return "#c82333";
				case "icon":
				default:
					return "#3c3c3c";
			}
		}};
		color: ${(props) => {
			switch (props.$variant) {
				case "icon":
					return "#ffffff";
				default:
					return props.$variant === "primary" ? "#ffffff" : "#cccccc";
			}
		}};
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`;

// === UNIVERSAL COMPONENTS FOR MAXIMUM CONSOLIDATION ===

const containerVariants = {
  default: css`
    background: ${COLORS.DARK_SURFACE};
    border: 1px solid ${COLORS.DARK_BORDER};
    border-radius: ${BORDER_RADIUS.MD};
  `,
  card: css`
    background: ${COLORS.DARK_SURFACE};
    border: 1px solid ${COLORS.DARK_BORDER};
    border-radius: ${BORDER_RADIUS.LG};
    box-shadow: ${SHADOWS.MD};
  `,
  output: css`
    background: ${COLORS.CODE_BG};
    border-top: 1px solid ${COLORS.DARK_BORDER};
  `,
  transparent: css`
    background: transparent;
    border: none;
  `
};

// Universal Container - replaces OutputContainer, MainContainer, etc.
export const Container = styled.div<{
  variant?: keyof typeof containerVariants;
  padding?: keyof typeof SPACING;
  margin?: keyof typeof SPACING;
  fullWidth?: boolean;
  fullHeight?: boolean;
}>`
  ${({ variant = 'default' }) => containerVariants[variant]}
  ${({ padding = 'MD' }) => css`padding: ${SPACING[padding]};`}
  ${({ margin }) => margin && css`margin: ${SPACING[margin]};`}
  ${({ fullWidth }) => fullWidth && css`width: 100%;`}
  ${({ fullHeight }) => fullHeight && css`height: 100%;`}
`;

const headerVariants = {
  flex: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  centered: css`
    display: flex;
    align-items: center;
    justify-content: center;
  `,
  left: css`
    display: flex;
    align-items: center;
    justify-content: flex-start;
  `
};

// Universal Header - replaces OutputHeader, ChatHeader, etc.
export const Header = styled.div<{
  variant?: keyof typeof headerVariants;
  margin?: keyof typeof SPACING;
  borderBottom?: boolean;
}>`
  ${({ variant = 'flex' }) => headerVariants[variant]}
  ${({ margin = 'MD' }) => css`margin-bottom: ${SPACING[margin]};`}
  ${({ borderBottom }) => borderBottom && css`
    border-bottom: 1px solid ${COLORS.DARK_BORDER};
    padding-bottom: ${SPACING.SM};
  `}
  color: ${COLORS.DARK_TEXT};
  font-weight: 500;
`;

const actionsVariants = {
  horizontal: css`
    display: flex;
    align-items: center;
    gap: ${SPACING.SM};
  `,
  spaced: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${SPACING.MD};
  `
};

// Universal Actions - replaces ButtonActions, CellActions, etc.
export const Actions = styled.div<{
  variant?: keyof typeof actionsVariants;
  gap?: keyof typeof SPACING;
}>`
  ${({ variant = 'horizontal' }) => actionsVariants[variant]}
  ${({ gap }) => gap && css`gap: ${SPACING[gap]};`}
`;

// Universal Table - replaces all DataTable duplications
export const UniversalTable = styled.div<{
  striped?: boolean;
}>`
  overflow-x: auto;
  margin: ${SPACING.SM} 0;
  border: 1px solid ${COLORS.DARK_BORDER};
  border-radius: ${BORDER_RADIUS.MD};
  background: ${COLORS.CODE_BG};
  
  table {
    width: 100%;
    border-collapse: collapse;
    
    th, td {
      padding: ${SPACING.SM} ${SPACING.MD};
      text-align: left;
      border-bottom: 1px solid ${COLORS.DARK_BORDER};
      color: ${COLORS.DARK_TEXT};
      font-size: 13px;
    }
    
    th {
      background: ${COLORS.DARK_SURFACE};
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: ${COLORS.DARK_MUTED};
    }
    
    ${({ striped }) => striped && css`
      tbody tr:nth-child(even) {
        background: ${COLORS.DARK_SURFACE}40;
      }
    `}
    
    tbody tr:hover {
      background: ${COLORS.HOVER};
    }
  }
`;

// Shared StatusIndicator with unified status types
export const StatusIndicator = styled.div<{
	$status: "running" | "stopped" | "starting" | "ready" | "error";
	$size?: "small" | "medium";
}>`
	font-size: ${(props) =>
		props.$size === "small" ? typography.xs : typography.sm};
	color: ${(props) => {
		switch (props.$status) {
			case "running":
			case "ready":
				return "#00ff00";
			case "starting":
				return "#ffff00";
			case "error":
			case "stopped":
				return "#ff0000";
			default:
				return "#858585";
		}
	}};
	display: flex;
	align-items: center;
	gap: 6px;
`;

// Shared LoadingMessage
export const LoadingMessage = styled.div`
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 40px;
	color: #858585;
	font-size: ${typography.base};
	text-align: center;
`;

// Shared EmptyState
export const EmptyState = styled.div`
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	height: 100%;
	color: #858585;
	font-size: ${typography.base};
	padding: 40px;
	text-align: center;
`;

// Shared Button component with variants
export const Button = styled.button<{
	$variant?: "primary" | "secondary" | "danger";
	$size?: "small" | "medium" | "large";
}>`
	background: ${(props) => {
		switch (props.$variant) {
			case "primary":
				return "#007acc";
			case "secondary":
				return "#2d2d30";
			case "danger":
				return "#dc3545";
			default:
				return "#2d2d30";
		}
	}};
	border: 1px solid
		${(props) => {
			switch (props.$variant) {
				case "primary":
					return "#005a9e";
				case "secondary":
					return "#404040";
				case "danger":
					return "#c82333";
				default:
					return "#404040";
			}
		}};
	color: #ffffff;
	cursor: pointer;
	padding: ${(props) => {
		switch (props.$size) {
			case "small":
				return "6px 12px";
			case "large":
				return "12px 24px";
			case "medium":
			default:
				return "8px 16px";
		}
	}};
	border-radius: 4px;
	font-size: ${(props) => {
		switch (props.$size) {
			case "small":
				return typography.sm;
			case "large":
				return typography.lg;
			case "medium":
			default:
				return typography.base;
		}
	}};
	transition: all 0.2s ease;

	&:hover {
		background: ${(props) => {
			switch (props.$variant) {
				case "primary":
					return "#005a9e";
				case "secondary":
					return "#404040";
				case "danger":
					return "#c82333";
				default:
					return "#404040";
			}
		}};
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`;

