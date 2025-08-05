import {
	typography,
	spacing,
	colors,
	borderRadius,
	shadows,
} from "./design-system";

// Typography utilities for styled-components
export const typographyUtils = {
	xs: `font-size: ${typography.xs};`,
	sm: `font-size: ${typography.sm};`,
	base: `font-size: ${typography.base};`,
	lg: `font-size: ${typography.lg};`,
	xl: `font-size: ${typography.xl};`,
	"2xl": `font-size: ${typography["2xl"]};`,
	"3xl": `font-size: ${typography["3xl"]};`,
} as const;

// Spacing utilities
export const spacingUtils = {
	xs: `padding: ${spacing.xs};`,
	sm: `padding: ${spacing.sm};`,
	md: `padding: ${spacing.md};`,
	lg: `padding: ${spacing.lg};`,
	xl: `padding: ${spacing.xl};`,
	"2xl": `padding: ${spacing["2xl"]};`,
	"3xl": `padding: ${spacing["3xl"]};`,
} as const;

// Margin utilities
export const marginUtils = {
	xs: `margin: ${spacing.xs};`,
	sm: `margin: ${spacing.sm};`,
	md: `margin: ${spacing.md};`,
	lg: `margin: ${spacing.lg};`,
	xl: `margin: ${spacing.xl};`,
	"2xl": `margin: ${spacing["2xl"]};`,
	"3xl": `margin: ${spacing["3xl"]};`,
} as const;

// Border radius utilities
export const borderRadiusUtils = {
	sm: `border-radius: ${borderRadius.sm};`,
	md: `border-radius: ${borderRadius.md};`,
	lg: `border-radius: ${borderRadius.lg};`,
	xl: `border-radius: ${borderRadius.xl};`,
	full: `border-radius: ${borderRadius.full};`,
} as const;

// Shadow utilities
export const shadowUtils = {
	sm: `box-shadow: ${shadows.sm};`,
	md: `box-shadow: ${shadows.md};`,
	lg: `box-shadow: ${shadows.lg};`,
} as const;

// Common text styles
export const textStyles = {
	caption: `
    font-size: ${typography.xs};
    color: ${colors.gray[500]};
  `,
	label: `
    font-size: ${typography.sm};
    color: ${colors.gray[600]};
    font-weight: 500;
  `,
	body: `
    font-size: ${typography.base};
    color: ${colors.gray[700]};
    line-height: 1.5;
  `,
	heading: `
    font-size: ${typography.lg};
    color: ${colors.gray[800]};
    font-weight: 600;
  `,
	title: `
    font-size: ${typography.xl};
    color: ${colors.gray[900]};
    font-weight: 700;
  `,
} as const;

// Common button styles
export const buttonStyles = {
	primary: `
    background-color: ${colors.primary[500]};
    color: white;
    border: none;
    border-radius: ${borderRadius.md};
    padding: ${spacing.sm} ${spacing.lg};
    font-size: ${typography.base};
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s;
    
    &:hover {
      background-color: ${colors.primary[600]};
    }
  `,
	secondary: `
    background-color: ${colors.gray[100]};
    color: ${colors.gray[700]};
    border: 1px solid ${colors.gray[300]};
    border-radius: ${borderRadius.md};
    padding: ${spacing.sm} ${spacing.lg};
    font-size: ${typography.base};
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    
    &:hover {
      background-color: ${colors.gray[200]};
      border-color: ${colors.gray[400]};
    }
  `,
} as const;
