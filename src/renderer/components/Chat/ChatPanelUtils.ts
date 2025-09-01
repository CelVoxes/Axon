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

// Unified diff using Myers' algorithm (near-linear in practice)
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

    // Myers' O(ND) diff for scalability on large inputs
    const ops: Array<{ t: ' ' | '+' | '-'; s: string }> = myersDiff(oldLines, newLines);

    const headerA = `--- a/${file}:${oldStart}-${oldStart + m - 1}`;
    const headerB = `+++ b/${file}:${oldStart}-${oldStart + n - 1}`;
    const hunk = `@@ -${oldStart},${m} +${oldStart},${n} @@`;

    const hasChanges = ops.some((o) => o.t !== ' ');
    if (!hasChanges) {
        return `${headerA}\n${headerB}\n${hunk}\n# No changes`;
    }

    const body = ops
        .map((o) => {
            const content = o.s ?? '';
            if (o.t === ' ') return `  ${content}`; // unchanged
            return `${o.t} ${content}`; // + or -
        })
        .join('\n');

    return `${headerA}\n${headerB}\n${hunk}\n${body}`;
};

function myersDiff(a: string[], b: string[]): Array<{ t: ' ' | '+' | '-'; s: string }> {
    const N = a.length;
    const M = b.length;
    const max = N + M;
    const offset = max;
    const v: number[] = Array(2 * max + 1).fill(0);
    const trace: number[][] = [];

    let found = false;
    for (let D = 0; D <= max; D++) {
        for (let k = -D; k <= D; k += 2) {
            let x: number;
            if (k === -D || (k !== D && v[offset + k - 1] < v[offset + k + 1])) {
                x = v[offset + k + 1];
            } else {
                x = v[offset + k - 1] + 1;
            }
            let y = x - k;
            while (x < N && y < M && a[x] === b[y]) {
                x++;
                y++;
            }
            v[offset + k] = x;
            if (x >= N && y >= M) {
                trace.push(v.slice());
                found = true;
                break;
            }
        }
        if (found) break;
        trace.push(v.slice());
    }

    // Backtrack
    const ops: Array<{ t: ' ' | '+' | '-'; s: string }> = [];
    let x = N;
    let y = M;
    for (let D = trace.length - 1; D >= 0; D--) {
        const vD = trace[D];
        const k = x - y;
        let prevK: number;
        if (k === -D || (k !== D && vD[offset + k - 1] < vD[offset + k + 1])) {
            prevK = k + 1; // insertion
        } else {
            prevK = k - 1; // deletion
        }
        const prevX = vD[offset + prevK];
        const prevY = prevX - prevK;

        // Diagonal (matches)
        while (x > prevX && y > prevY) {
            ops.push({ t: ' ', s: a[x - 1] });
            x--;
            y--;
        }
        if (D > 0) {
            if (x === prevX) {
                // insertion
                ops.push({ t: '+', s: b[y - 1] });
                y--;
            } else {
                // deletion
                ops.push({ t: '-', s: a[x - 1] });
                x--;
            }
        }
    }

    return ops.reverse();
}

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
