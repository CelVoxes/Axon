export interface NdjsonHandlers<T = any> {
	onLine?: (data: T) => void;
	onError?: (message: string) => void;
	onProgress?: (payload: any) => void;
}

export async function readNdjsonStream<T = any>(
	response: Response,
	handlers: NdjsonHandlers<T> = {}
): Promise<void> {
	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}
	const reader = response.body?.getReader();
	if (!reader) throw new Error("No response body");

	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() || "";

		for (const line of lines) {
			if (!line.trim()) continue;
			if (!line.startsWith("data: ")) continue;
			try {
				const json = JSON.parse(line.slice(6));
				if (json.type === "progress" && handlers.onProgress) {
					handlers.onProgress(json);
				} else if (json.type === "error" && handlers.onError) {
					handlers.onError(json.message || "Unknown error");
				} else if (handlers.onLine) {
					handlers.onLine(json as T);
				}
			} catch (e) {
				handlers.onError?.("Failed to parse NDJSON line");
			}
		}
	}
}

export async function readDataStream(
	response: Response,
	onChunk: (chunk: string) => void
): Promise<string> {
	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`HTTP ${response.status}: ${response.statusText} - ${errorText}`
		);
	}
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Response body is not readable");

	const decoder = new TextDecoder();
	let result = "";
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		// Use streaming decode to handle multi-byte characters across chunks
		buffer += decoder.decode(value, { stream: true });

		// Process complete lines only; keep partial in buffer
		const lines = buffer.split("\n");
		buffer = lines.pop() || "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			if (!trimmed.startsWith("data: ")) continue;
			try {
				const jsonStr = trimmed.slice(6);
				const data = JSON.parse(jsonStr);
				const text = data.chunk ?? data.content ?? "";
				if (text) {
					onChunk(text);
					result += text;
				}
			} catch {
				// ignore malformed partials; they will be completed in subsequent chunks
			}
		}
	}

	// Flush any remaining buffered data if it's a complete JSON line
	const final = buffer.trim();
	if (final && final.startsWith("data: ")) {
		try {
			const data = JSON.parse(final.slice(6));
			const text = data.chunk ?? data.content ?? "";
			if (text) {
				onChunk(text);
				result += text;
			}
		} catch {
			// ignore
		}
	}

	return result;
}
