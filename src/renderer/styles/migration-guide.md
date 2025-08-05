# Design System Migration Guide

## Problem

The codebase has **dozens of inconsistent font sizes** scattered across components:

- `10px`, `11px`, `12px`, `13px`, `14px`, `16px`, `18px`, `20px`, `24px`
- No consistent typography scale
- Hard to maintain and looks unprofessional

## Solution: Design System

### Typography Scale

```typescript
// Use these consistent font sizes:
xs: '10px'      // Captions, metadata
sm: '12px'      // Labels, secondary text
base: '14px'    // Body text (default)
lg: '16px'      // Subheadings, important text
xl: '18px'      // Headings
'2xl': '20px'   // Main headings
'3xl': '24px'   // Hero headings
```

## Migration Steps

### 1. Replace Hardcoded Font Sizes

**Before:**

```typescript
const StyledComponent = styled.div`
	font-size: 13px; // ❌ Inconsistent
`;
```

**After:**

```typescript
import { typography } from "../styles/design-system";

const StyledComponent = styled.div`
	font-size: ${typography.base}; // ✅ Consistent
`;
```

### 2. Use Text Style Utilities

**Before:**

```typescript
const Label = styled.span`
	font-size: 12px;
	color: #6b7280;
	font-weight: 500;
`;
```

**After:**

```typescript
import { textStyles } from "../styles/styled-utils";

const Label = styled.span`
	${textStyles.label}
`;
```

### 3. Common Replacements

| Current Size | Replace With        | Use Case               |
| ------------ | ------------------- | ---------------------- |
| `10px`       | `typography.xs`     | Captions, metadata     |
| `11px`       | `typography.xs`     | Small captions         |
| `12px`       | `typography.sm`     | Labels, secondary text |
| `13px`       | `typography.base`   | Body text              |
| `14px`       | `typography.base`   | Body text              |
| `16px`       | `typography.lg`     | Subheadings            |
| `18px`       | `typography.xl`     | Headings               |
| `20px`       | `typography['2xl']` | Main headings          |
| `24px`       | `typography['3xl']` | Hero headings          |

## Files to Update

### High Priority (Most Inconsistent)

1. `src/renderer/styles/global.css` - 40+ font-size declarations
2. `src/renderer/components/Chat/DatasetSelectionModal.tsx` - 10 font-size declarations
3. `src/renderer/components/Chat/ChatMessage.tsx` - 15 font-size declarations

### Medium Priority

4. `src/renderer/components/MainContent/Notebook.tsx`
5. `src/renderer/components/MainContent/CodeCell.tsx`
6. `src/renderer/components/Sidebar/Sidebar.tsx`

### Low Priority

7. `src/renderer/components/shared/StyledComponents.tsx`
8. Other component files

## Benefits

✅ **Consistent UI** - All text follows the same scale  
✅ **Easier Maintenance** - Change font sizes in one place  
✅ **Better UX** - Professional, cohesive appearance  
✅ **Type Safety** - TypeScript ensures correct usage  
✅ **Scalability** - Easy to add new sizes or themes

## Quick Start

1. Import the design system:

```typescript
import { typography } from "../styles/design-system";
```

2. Replace hardcoded sizes:

```typescript
// Instead of: font-size: 13px;
font-size: ${typography.base};
```

3. Use text styles for common patterns:

```typescript
import { textStyles } from '../styles/styled-utils';

// Instead of multiple CSS properties
${textStyles.body}
```
