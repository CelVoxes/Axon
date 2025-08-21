import { BackendClient } from "../../../services/BackendClient";
import { LocalDatasetEntry } from "../../../services/LocalDatasetRegistry";

export class ChatCommunicationService {
	constructor(private backendClient: BackendClient) {}

	async askQuestion(question: string, context: string): Promise<string> {
		return await this.backendClient.askQuestion({
			question,
			context,
		});
	}

	async generateAgentResponse(
		userMessage: string,
		mentionDatasets: LocalDatasetEntry[],
		selectedDatasets: any[],
		cellMentionContext?: {
			filePath: string;
			cellIndex0: number;
			language: string;
			code: string;
		}
	): Promise<void> {
		// This would contain the agent mode logic that was in handleSendMessage
		// For now, this is a placeholder that would need to be implemented
		// based on the specific agent logic in the ChatPanel
		throw new Error("Agent mode not yet extracted - this is complex logic that needs careful extraction");
	}

	buildContextFromMessages(messages: any[]): string {
		const recent = (messages || []).slice(-10);
		return recent
			.map((m: any) => {
				const text = typeof m.content === "string" ? m.content : "";
				const codeStr =
					typeof m.code === "string" && m.code.trim().length > 0
						? `\n\n\`\`\`${m.codeLanguage || "python"}\n${m.code}\n\`\`\`\n`
						: "";
				return text + codeStr;
			})
			.filter(Boolean)
			.join("\n\n");
	}
}