// Utility functions for ChatPanel component

// Utility function to group chat sessions by time periods
export function groupSessionsByTime(sessions: any[]) {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
	const twoDaysAgo = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);
	const threeDaysAgo = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);
	const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

	const groups = {
		today: [] as any[],
		yesterday: [] as any[],
		"2d ago": [] as any[],
		"3d ago": [] as any[],
		"this week": [] as any[],
		older: [] as any[],
	};

	sessions.forEach((session) => {
		const sessionDate = new Date(session.updatedAt || session.createdAt);
		const sessionDay = new Date(
			sessionDate.getFullYear(),
			sessionDate.getMonth(),
			sessionDate.getDate()
		);

		if (sessionDay.getTime() >= today.getTime()) {
			groups.today.push(session);
		} else if (sessionDay.getTime() >= yesterday.getTime()) {
			groups.yesterday.push(session);
		} else if (sessionDay.getTime() >= twoDaysAgo.getTime()) {
			groups["2d ago"].push(session);
		} else if (sessionDay.getTime() >= threeDaysAgo.getTime()) {
			groups["3d ago"].push(session);
		} else if (sessionDay.getTime() >= oneWeekAgo.getTime()) {
			groups["this week"].push(session);
		} else {
			groups.older.push(session);
		}
	});

	// Sort sessions within each group by updatedAt (most recent first)
	Object.keys(groups).forEach((key) => {
		groups[key as keyof typeof groups].sort((a, b) => {
			const aTime = new Date(a.updatedAt || a.createdAt).getTime();
			const bTime = new Date(b.updatedAt || b.createdAt).getTime();
			return bTime - aTime;
		});
	});

	return groups;
}

// String manipulation utilities
export const stripCodeFences = (text: string): string => {
	return text
		.replace(/^\s*```[a-zA-Z]*\s*/g, "")
		.replace(/\s*```\s*$/g, "")
		.trim();
};

// Helper: compute selection range from a user message requesting specific line(s)
export const computeSelectionFromMessage = (
	fullCode: string,
	userMessage: string
): {
	selStart: number;
	selEnd: number;
	startLine: number;
	endLine: number;
	withinSelection: string;
} => {
	let selStart = 0;
	let selEnd = fullCode.length;
	let startLine = 1;
	let endLine = (fullCode.match(/\n/g)?.length ?? 0) + 1;
	try {
		const lm =
			userMessage.match(/lines?\s+(\d+)(?:\s*-\s*(\d+))?/i) ||
			userMessage.match(/line\s+(\d+)/i);
		if (lm) {
			const s = Math.max(1, parseInt(lm[1] || "1", 10));
			const e = Math.max(s, parseInt(lm[2] || String(s), 10));
			const lineStartPositions: number[] = [0];
			for (let i = 0; i < fullCode.length; i++) {
				if (fullCode[i] === "\n") lineStartPositions.push(i + 1);
			}
			startLine = Math.min(s, lineStartPositions.length);
			endLine = Math.min(e, lineStartPositions.length);
			selStart = lineStartPositions[startLine - 1] ?? 0;
			selEnd =
				lineStartPositions[endLine] !== undefined
					? lineStartPositions[endLine]
					: fullCode.length;
		}
	} catch (_) {}
	const withinSelection = fullCode.slice(selStart, selEnd);
	return { selStart, selEnd, startLine, endLine, withinSelection };
};

// Helper: unified diff for selection updates
export const buildUnifiedDiff = (
	oldText: string,
	newText: string,
	file: string,
	oldStart: number
) => {
	const oldLines = oldText.split("\n");
	const newLines = newText.split("\n");
	const m = oldLines.length;
	const n = newLines.length;
	const lcs: number[][] = Array.from({ length: m + 1 }, () =>
		Array(n + 1).fill(0)
	);
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (oldLines[i - 1] === newLines[j - 1]) {
				lcs[i][j] = lcs[i - 1][j - 1] + 1;
			} else {
				lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
			}
		}
	}
	const ops: Array<{ t: " " | "+" | "-"; s: string }> = [];
	let i = m,
		j = n;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
			ops.push({ t: " ", s: oldLines[i - 1] });
			i--;
			j--;
		} else if (j > 0 && (i === 0 || lcs[i][j - 1] > lcs[i - 1][j])) {
			ops.push({ t: "+", s: newLines[j - 1] });
			j--;
		} else if (i > 0) {
			ops.push({ t: "-", s: oldLines[i - 1] });
			i--;
		}
	}
	ops.reverse();
	const oldCount = m;
	const newCount = n;
	const newStart = oldStart; // selection replaced in place
	const headerA = `--- a/${file}:${oldStart}-${oldStart + oldCount - 1}`;
	const headerB = `+++ b/${file}:${newStart}-${newStart + newCount - 1}`;
	const hunk = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
	const body = ops
		.map((o) => {
			const content = o.s.length === 0 ? "" : o.s;
			if (o.t === " ") {
				return `  ${content}`; // Two spaces for unchanged lines
			} else {
				return `${o.t} ${content}`; // Space after + or -
			}
		})
		.join("\n");
	return `${headerA}\n${headerB}\n${hunk}\n${body}`;
};

// Types and functions for line edits
export type LineEdit = {
	startLine: number; // 1-based, inclusive
	endLine: number; // 1-based, inclusive
	replacement: string; // exact text to replace the range with
};

export const parseJsonEdits = (text: string): LineEdit[] | null => {
	try {
		const cleaned = stripCodeFences(text);
		// Extract JSON array if there is extra prose
		const arrayMatch = cleaned.match(/\[([\s\S]*)\]$/);
		const candidate = arrayMatch ? `[${arrayMatch[1]}]` : cleaned;
		const parsed = JSON.parse(candidate);
		if (Array.isArray(parsed)) {
			const edits: LineEdit[] = parsed
				.map((e) => ({
					startLine: Number(e.startLine),
					endLine: Number(e.endLine),
					replacement: String(e.replacement ?? ""),
				}))
				.filter(
					(e) =>
						Number.isFinite(e.startLine) &&
						Number.isFinite(e.endLine) &&
						e.startLine >= 1 &&
						e.endLine >= e.startLine
				);
			return edits.length > 0 ? edits : null;
		}
		// Support single-object edit
		if (parsed && typeof parsed === "object") {
			const e = parsed as any;
			const startLine = Number(e.startLine);
			const endLine = Number(e.endLine);
			if (
				Number.isFinite(startLine) &&
				Number.isFinite(endLine) &&
				startLine >= 1 &&
				endLine >= startLine
			) {
				return [
					{
						startLine,
						endLine,
						replacement: String(e.replacement ?? ""),
					},
				];
			}
		}
	} catch {
		// ignore
	}
	return null;
};

export const applyLineEdits = (original: string, edits: LineEdit[]): string => {
	const normalizedOriginal = original.replace(/\r\n/g, "\n");
	let lines = normalizedOriginal.split("\n");
	// Apply from bottom-most edit to top to preserve indices
	const sorted = [...edits].sort((a, b) => b.startLine - a.startLine);
	for (const edit of sorted) {
		const startIdx = Math.max(0, Math.min(lines.length, edit.startLine - 1));
		const endIdx = Math.max(startIdx, Math.min(lines.length, edit.endLine));
		const replacementLines = String(edit.replacement)
			.replace(/\r\n/g, "\n")
			.split("\n");
		lines = [
			...lines.slice(0, startIdx),
			...replacementLines,
			...lines.slice(endIdx),
		];
	}
	return lines.join("\n");
};
