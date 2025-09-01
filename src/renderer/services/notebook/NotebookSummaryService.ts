import { BackendClient } from "../backend/BackendClient";
import { SummaryOptions, NotebookCell } from "../../components/shared/SummaryOptionsModal";

export interface ProcessedCell {
	index: number;
	type: "code" | "markdown";
	content: string;
	outputs?: string[];
	visualOutputs?: VisualOutput[];
	executionCount?: number | null;
}

export interface VisualOutput {
	type: 'figure' | 'table' | 'image';
	format: string;
	data?: string;
	description?: string;
}

export interface NotebookAnalysis {
	title: string;
	cellCount: number;
	codeCount: number;
	markdownCount: number;
	hasOutputs: boolean;
	sections: string[];
	keyFindings: string[];
}

export interface GeneratedSummary {
	title: string;
	content: string;
	format: string;
	generatedAt: string;
	options: SummaryOptions;
	analysis: NotebookAnalysis;
}

export class NotebookSummaryService {
	private backendClient: BackendClient;

	constructor(backendClient: BackendClient) {
		this.backendClient = backendClient;
	}

	/**
	 * Process notebook cells into structured format for analysis
	 */
	processCells(cells: NotebookCell[], selectedIndices: number[]): ProcessedCell[] {
		const selectedCells = selectedIndices.map(index => cells[index]).filter(Boolean);
		
		return selectedCells.map((cell, arrayIndex) => {
			const originalIndex = selectedIndices[arrayIndex];
			const content = Array.isArray(cell.source) 
				? cell.source.join('') 
				: cell.source || '';

			const outputs: string[] = [];
			const visualOutputs: VisualOutput[] = [];
			
			if (cell.outputs && Array.isArray(cell.outputs)) {
				cell.outputs.forEach(output => {
					if (output.output_type === "stream" && output.text) {
						outputs.push(Array.isArray(output.text) ? output.text.join('') : output.text);
					} else if (output.output_type === "execute_result" && output.data) {
						const textPlain = output.data["text/plain"];
						if (textPlain) {
							const textContent = Array.isArray(textPlain) ? textPlain.join('') : textPlain;
							outputs.push(textContent);
							
							// Check if this looks like a table (has structured data)
							if (this.isTableOutput(textContent)) {
								visualOutputs.push({
									type: 'table',
									format: 'text',
									data: textContent,
									description: 'Data table output'
								});
							}
						}
						
						// Check for image outputs (matplotlib, plotly, etc.)
						if (output.data["image/png"] || output.data["image/jpeg"]) {
							visualOutputs.push({
								type: 'figure',
								format: output.data["image/png"] ? 'png' : 'jpeg',
								data: output.data["image/png"] || output.data["image/jpeg"],
								description: 'Generated plot/figure'
							});
						}
						
						// Check for HTML tables or plotly outputs
						if (output.data["text/html"]) {
							const htmlContent = Array.isArray(output.data["text/html"]) 
								? output.data["text/html"].join('') 
								: output.data["text/html"];
							
							if (htmlContent.includes('<table') || htmlContent.includes('dataframe')) {
								visualOutputs.push({
									type: 'table',
									format: 'html',
									data: htmlContent,
									description: 'HTML data table'
								});
							} else if (htmlContent.includes('plotly') || htmlContent.includes('chart')) {
								visualOutputs.push({
									type: 'figure',
									format: 'html',
									data: htmlContent,
									description: 'Interactive plot/chart'
								});
							}
						}
					} else if (output.output_type === "error") {
						outputs.push(`Error: ${output.ename}: ${output.evalue}`);
					}
				});
			}

			return {
				index: originalIndex,
				type: cell.cell_type,
				content: content.trim(),
				outputs: outputs.length > 0 ? outputs : undefined,
				visualOutputs: visualOutputs.length > 0 ? visualOutputs : undefined,
				executionCount: cell.execution_count,
			};
		});
	}

	/**
	 * Check if text output looks like a table
	 */
	private isTableOutput(text: string): boolean {
		// Simple heuristics to detect tabular data
		const lines = text.split('\n');
		if (lines.length < 3) return false; // Need at least header, separator, and data
		
		// Look for common table patterns
		const hasMultipleColumns = lines.some(line => 
			(line.includes('\t') && line.split('\t').length > 2) || // Tab-separated
			(line.includes('|') && line.split('|').length > 2) || // Pipe-separated
			(/\s{3,}/.test(line) && line.trim().split(/\s{3,}/).length > 2) // Space-separated
		);
		
		// Check for DataFrame-like patterns
		const hasDataFrameIndicators = text.includes('dtype:') || 
			text.includes('Index:') || 
			text.includes('Columns:') ||
			/^\s*\d+\s+/.test(lines[1]); // Numeric index pattern
		
		return hasMultipleColumns || hasDataFrameIndicators;
	}

	/**
	 * Analyze notebook structure and content
	 */
	analyzeNotebook(cells: NotebookCell[], filePath: string): NotebookAnalysis {
		const title = filePath.split('/').pop()?.replace('.ipynb', '') || 'Notebook Analysis';
		const codeCount = cells.filter(cell => cell.cell_type === 'code').length;
		const markdownCount = cells.filter(cell => cell.cell_type === 'markdown').length;
		const hasOutputs = cells.some(cell => cell.outputs && cell.outputs.length > 0);

		// Extract sections from markdown headers
		const sections: string[] = [];
		cells.forEach(cell => {
			if (cell.cell_type === 'markdown') {
				const content = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
				const headerMatch = content.match(/^#+\s+(.+)$/gm);
				if (headerMatch) {
					headerMatch.forEach(header => {
						const headerText = header.replace(/^#+\s+/, '').trim();
						if (headerText && !sections.includes(headerText)) {
							sections.push(headerText);
						}
					});
				}
			}
		});

		// Identify potential key findings from code outputs
		const keyFindings: string[] = [];
		cells.forEach(cell => {
			if (cell.cell_type === 'code' && cell.outputs) {
				cell.outputs.forEach(output => {
					if (output.output_type === 'execute_result' || output.output_type === 'stream') {
						// Look for common result patterns
						const text = output.text || output.data?.['text/plain'] || '';
						const textStr = Array.isArray(text) ? text.join('') : text;
						
						// Simple heuristics for interesting findings
						if (textStr.includes('accuracy') || textStr.includes('precision') || 
							textStr.includes('recall') || textStr.includes('correlation') ||
							textStr.includes('%') || /\d+\.\d+/.test(textStr)) {
							const finding = textStr.substring(0, 100).trim();
							if (finding && !keyFindings.includes(finding)) {
								keyFindings.push(finding);
							}
						}
					}
				});
			}
		});

		return {
			title,
			cellCount: cells.length,
			codeCount,
			markdownCount,
			hasOutputs,
			sections: sections.slice(0, 10), // Limit to avoid overwhelming
			keyFindings: keyFindings.slice(0, 5), // Top 5 findings
		};
	}

	/**
	 * Generate AI-powered summary based on processed cells and options
	 */
	async generateSummary(
		cells: NotebookCell[],
		options: SummaryOptions,
		filePath: string
	): Promise<GeneratedSummary> {
		const processedCells = this.processCells(cells, options.selectedCells);
		const analysis = this.analyzeNotebook(cells, filePath);

		// Build context for AI model
		const context = this.buildAnalysisContext(processedCells, analysis, options);
		
		// Generate summary using backend AI
		const summaryContent = await this.generateAISummary(context, options);

		// Format the final summary
		const formattedSummary = this.formatSummary(summaryContent, options, analysis);

		return {
			title: `${analysis.title} - ${this.getReportTypeLabel(options.reportType)}`,
			content: formattedSummary,
			format: options.outputFormat,
			generatedAt: new Date().toISOString(),
			options,
			analysis,
		};
	}

	/**
	 * Build structured context for AI analysis
	 */
	private buildAnalysisContext(
		processedCells: ProcessedCell[],
		analysis: NotebookAnalysis,
		options: SummaryOptions
	): string {
		let context = `# Notebook Analysis Context\n\n`;
		
		// Count visual elements for context
		const figureCount = processedCells.reduce((count, cell) => 
			count + (cell.visualOutputs?.filter(vo => vo.type === 'figure').length || 0), 0);
		const tableCount = processedCells.reduce((count, cell) => 
			count + (cell.visualOutputs?.filter(vo => vo.type === 'table').length || 0), 0);
		
		// Notebook overview
		context += `## Notebook Overview\n`;
		context += `- Title: ${analysis.title}\n`;
		context += `- Total cells: ${analysis.cellCount}\n`;
		context += `- Selected cells: ${processedCells.length}\n`;
		context += `- Code cells: ${analysis.codeCount}\n`;
		context += `- Markdown cells: ${analysis.markdownCount}\n`;
		context += `- Has outputs: ${analysis.hasOutputs}\n`;
		if (figureCount > 0 || tableCount > 0) {
			context += `- Visual elements: ${figureCount} figures, ${tableCount} tables\n`;
		}
		context += `\n`;

		// Sections if available
		if (analysis.sections.length > 0) {
			context += `## Document Sections\n`;
			analysis.sections.forEach(section => {
				context += `- ${section}\n`;
			});
			context += `\n`;
		}

		// Key findings if available
		if (analysis.keyFindings.length > 0) {
			context += `## Key Findings\n`;
			analysis.keyFindings.forEach(finding => {
				context += `- ${finding}\n`;
			});
			context += `\n`;
		}

		// Cell contents
		context += `## Cell Contents\n\n`;
		processedCells.forEach(cell => {
			context += `### Cell ${cell.index + 1} (${cell.type.toUpperCase()})\n`;
			
			if (cell.content) {
				if (options.includeCode || cell.type === 'markdown') {
					context += `\`\`\`${cell.type === 'code' ? 'python' : 'markdown'}\n`;
					context += cell.content;
					context += `\n\`\`\`\n\n`;
				}
			}
			
			if (options.includeOutputs && cell.outputs && cell.outputs.length > 0) {
				context += `**Outputs:**\n`;
				cell.outputs.forEach(output => {
					context += `\`\`\`\n${output}\n\`\`\`\n`;
				});
				context += `\n`;
			}
			
			// Include visual outputs if requested
			if (cell.visualOutputs && cell.visualOutputs.length > 0) {
				const figures = cell.visualOutputs.filter(vo => vo.type === 'figure');
				const tables = cell.visualOutputs.filter(vo => vo.type === 'table');
				
				if (options.includeFigures && figures.length > 0) {
					context += `**Figures (${figures.length}):**\n`;
					figures.forEach((figure, idx) => {
						context += `- Figure ${idx + 1}: ${figure.description} (${figure.format})\n`;
					});
					context += `\n`;
				}
				
				if (options.includeTables && tables.length > 0) {
					context += `**Tables (${tables.length}):**\n`;
					tables.forEach((table, idx) => {
						context += `- Table ${idx + 1}: ${table.description} (${table.format})\n`;
						if (table.format === 'text' && table.data) {
							// Include a preview of text tables
							const preview = table.data.substring(0, 200).replace(/\n/g, ' ');
							context += `  Preview: ${preview}${table.data.length > 200 ? '...' : ''}\n`;
						}
					});
					context += `\n`;
				}
			}
		});

		return context;
	}

	/**
	 * Generate AI summary using backend client
	 */
	private async generateAISummary(context: string, options: SummaryOptions): Promise<string> {
		const prompt = this.buildSummaryPrompt(options.reportType, options.summaryLength);

		try {
			// Use the backend client's askQuestion method for AI generation
			const response = await this.backendClient.askQuestion({
				question: prompt,
				context: context,
			});

			return response || "Unable to generate summary at this time.";
		} catch (error) {
			console.error('Error generating AI summary:', error);
			return this.generateFallbackSummary(context, options);
		}
	}

	/**
	 * Build report-specific prompts for AI generation
	 */
	private buildSummaryPrompt(reportType: SummaryOptions['reportType'], summaryLength: SummaryOptions['summaryLength']): string {
		const basePrompt = "You are an expert data scientist and technical writer. ";
		
		// Get length-specific instructions
		const lengthInstruction = this.getLengthInstruction(summaryLength);
		
		switch (reportType) {
			case 'quick-summary':
				return basePrompt + 
					"Create a concise, bullet-point summary of this Jupyter notebook. " +
					"Focus on the main objectives, key methods used, and primary findings. " +
					"Use clear, non-technical language where possible. " + lengthInstruction;
			
			case 'research-report':
				return basePrompt +
					"Create a comprehensive research report based on this Jupyter notebook analysis. " +
					"Structure it with: Introduction, Methods, Results, Discussion, and Conclusion. " +
					"Include technical details, statistical findings, and insights. " +
					"Write in an academic style suitable for publication or presentation. " + lengthInstruction;
			
			case 'technical-doc':
				return basePrompt +
					"Create detailed technical documentation for this Jupyter notebook. " +
					"Include code explanations, methodology details, parameter descriptions, " +
					"and implementation notes. Focus on reproducibility and technical accuracy. " +
					"Structure it as a technical guide for other developers or researchers. " + lengthInstruction;
			
			default:
				return basePrompt + "Summarize the contents of this Jupyter notebook. " + lengthInstruction;
		}
	}

	/**
	 * Get length-specific instruction for AI prompts
	 */
	private getLengthInstruction(summaryLength: SummaryOptions['summaryLength']): string {
		switch (summaryLength) {
			case 'brief':
				return "Keep the summary brief and concise, targeting approximately 200 words. Focus only on the most essential points.";
			case 'medium':
				return "Create a medium-length summary of approximately 500 words. Include key details and main findings.";
			case 'detailed':
				return "Provide a detailed summary of approximately 1000 words. Include comprehensive analysis, methodology details, and findings.";
			case 'comprehensive':
				return "Create a comprehensive summary of approximately 2000+ words. Include extensive details, full methodology, all findings, and thorough analysis.";
			default:
				return "Create a well-structured summary with appropriate level of detail.";
		}
	}

	/**
	 * Format the generated summary based on output preferences
	 */
	private formatSummary(
		content: string, 
		options: SummaryOptions, 
		analysis: NotebookAnalysis
	): string {
		const timestamp = new Date().toLocaleString();
		
		let formatted = `# ${analysis.title} - ${this.getReportTypeLabel(options.reportType)}\n\n`;
		formatted += `*Generated on ${timestamp}*\n\n`;
		formatted += `---\n\n`;
		formatted += content;
		formatted += `\n\n---\n\n`;
		formatted += `## Summary Statistics\n`;
		formatted += `- Total cells analyzed: ${options.selectedCells.length}\n`;
		formatted += `- Code cells: ${analysis.codeCount}\n`;
		formatted += `- Markdown cells: ${analysis.markdownCount}\n`;
		formatted += `- Report type: ${this.getReportTypeLabel(options.reportType)}\n`;
		formatted += `- Generated by: Axon AI Summary\n`;

		return formatted;
	}

	/**
	 * Generate fallback summary when AI fails
	 */
	private generateFallbackSummary(context: string, options: SummaryOptions): string {
		return `# Summary Generation Failed

Unfortunately, we couldn't generate an AI-powered summary at this time. Here's a basic analysis:

## Selected Content
${options.selectedCells.length} cells were selected for analysis.

## Report Type
${this.getReportTypeLabel(options.reportType)}

## Content Options
- Include code: ${options.includeCode ? 'Yes' : 'No'}
- Include outputs: ${options.includeOutputs ? 'Yes' : 'No'}
- Include figures: ${options.includeFigures ? 'Yes' : 'No'}
- Include tables: ${options.includeTables ? 'Yes' : 'No'}
- Summary length: ${this.getSummaryLengthLabel(options.summaryLength)}

Please try again later or contact support if this issue persists.`;
	}

	/**
	 * Get human-readable report type labels
	 */
	private getReportTypeLabel(reportType: SummaryOptions['reportType']): string {
		switch (reportType) {
			case 'quick-summary':
				return 'Quick Summary';
			case 'research-report':
				return 'Research Report';
			case 'technical-doc':
				return 'Technical Documentation';
			default:
				return 'Summary';
		}
	}

	/**
	 * Get human-readable summary length labels
	 */
	private getSummaryLengthLabel(summaryLength: SummaryOptions['summaryLength']): string {
		switch (summaryLength) {
			case 'brief':
				return 'Brief (~200 words)';
			case 'medium':
				return 'Medium (~500 words)';
			case 'detailed':
				return 'Detailed (~1000 words)';
			case 'comprehensive':
				return 'Comprehensive (~2000+ words)';
			default:
				return 'Medium';
		}
	}

	/**
	 * Get appropriate token limits for different report types
	 */
	private getMaxTokensForReportType(reportType: SummaryOptions['reportType']): number {
		switch (reportType) {
			case 'quick-summary':
				return 500;
			case 'research-report':
				return 2000;
			case 'technical-doc':
				return 3000;
			default:
				return 1000;
		}
	}

	/**
	 * Export summary to file
	 */
	async exportSummary(summary: GeneratedSummary, outputPath: string): Promise<boolean> {
		try {
			let finalContent = summary.content;
			
			// Format based on output type
			if (summary.format === 'html') {
				finalContent = this.convertMarkdownToHTML(summary.content);
			} else if (summary.format === 'pdf') {
				// For PDF, we'll convert to HTML first and then use Electron's built-in PDF generation
				return await this.generatePDF(summary, outputPath);
			}

			// Use electron API to write file
			const result = await (window as any).electronAPI.writeFile(outputPath, finalContent);
			return result?.success === true;
		} catch (error) {
			console.error('Error exporting summary:', error);
			return false;
		}
	}

	/**
	 * Generate PDF using Electron's built-in PDF capabilities
	 */
	private async generatePDF(summary: GeneratedSummary, outputPath: string): Promise<boolean> {
		try {
			// Convert markdown to HTML first
			const htmlContent = this.convertMarkdownToHTML(summary.content);
			
			// Enhanced HTML template with better PDF styling
			const pdfHtml = `<!DOCTYPE html>
<html>
<head>
	<title>${summary.title}</title>
	<meta charset="utf-8">
	<style>
		@page {
			margin: 1in;
			size: A4;
		}
		
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
			line-height: 1.6;
			color: #333;
			max-width: none;
			margin: 0;
			padding: 0;
		}
		
		h1 {
			color: #2d3748;
			border-bottom: 3px solid #6366f1;
			padding-bottom: 10px;
			margin-top: 30px;
			margin-bottom: 20px;
			page-break-after: avoid;
		}
		
		h2 {
			color: #4a5568;
			border-bottom: 2px solid #e2e8f0;
			padding-bottom: 8px;
			margin-top: 25px;
			margin-bottom: 15px;
			page-break-after: avoid;
		}
		
		h3 {
			color: #718096;
			margin-top: 20px;
			margin-bottom: 12px;
			page-break-after: avoid;
		}
		
		p {
			margin-bottom: 12px;
			text-align: justify;
		}
		
		code {
			background: #f7fafc;
			padding: 2px 4px;
			border-radius: 3px;
			font-family: 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
			font-size: 0.9em;
			color: #e53e3e;
		}
		
		pre {
			background: #f7fafc;
			padding: 15px;
			border-radius: 5px;
			overflow-x: auto;
			border-left: 4px solid #6366f1;
			margin: 15px 0;
			page-break-inside: avoid;
		}
		
		pre code {
			background: none;
			padding: 0;
			color: #2d3748;
		}
		
		hr {
			border: none;
			border-top: 1px solid #e2e8f0;
			margin: 25px 0;
		}
		
		ul, ol {
			margin-bottom: 15px;
			padding-left: 25px;
		}
		
		li {
			margin-bottom: 5px;
		}
		
		.header-meta {
			color: #718096;
			font-style: italic;
			margin-bottom: 30px;
			padding: 10px;
			background: #f7fafc;
			border-radius: 5px;
		}
		
		.page-break {
			page-break-before: always;
		}
		
		@media print {
			body { -webkit-print-color-adjust: exact; }
		}
	</style>
</head>
<body>
${htmlContent}
</body>
</html>`;

			// Use Electron's PDF generation API
			const result = await (window as any).electronAPI.generatePDF?.({
				html: pdfHtml,
				outputPath: outputPath,
				options: {
					format: 'A4',
					printBackground: true,
					margin: {
						top: '1in',
						right: '1in',
						bottom: '1in',
						left: '1in'
					}
				}
			});

			if (result?.success) {
				return true;
			} else {
				// Fallback: if PDF generation fails, save as HTML with PDF extension
				console.warn('PDF generation failed, saving as HTML with .pdf extension');
				const fallbackResult = await (window as any).electronAPI.writeFile(outputPath, pdfHtml);
				return fallbackResult?.success === true;
			}
		} catch (error) {
			console.error('Error generating PDF:', error);
			
			// Fallback: save as markdown with .pdf extension
			console.warn('PDF generation failed, falling back to markdown');
			const fallbackResult = await (window as any).electronAPI.writeFile(outputPath, summary.content);
			return fallbackResult?.success === true;
		}
	}

	/**
	 * Basic markdown to HTML conversion
	 */
	private convertMarkdownToHTML(markdown: string): string {
		// Basic markdown to HTML conversion
		// In a real implementation, you'd use a proper markdown parser
		let html = markdown
			.replace(/^# (.+)$/gm, '<h1>$1</h1>')
			.replace(/^## (.+)$/gm, '<h2>$1</h2>')
			.replace(/^### (.+)$/gm, '<h3>$1</h3>')
			.replace(/^\* (.+)$/gm, '<li>$1</li>')
			.replace(/^---$/gm, '<hr>')
			.replace(/\*(.+?)\*/g, '<em>$1</em>')
			.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
			.replace(/`(.+?)`/g, '<code>$1</code>')
			.replace(/```(.+?)```/gs, '<pre><code>$1</code></pre>');

		return `<!DOCTYPE html>
<html>
<head>
	<title>Notebook Summary</title>
	<style>
		body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
		code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }
		pre { background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto; }
		hr { border: none; border-top: 1px solid #ddd; margin: 20px 0; }
	</style>
</head>
<body>
${html}
</body>
</html>`;
	}
}