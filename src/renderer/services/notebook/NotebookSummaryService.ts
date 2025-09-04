import { BackendClient } from "../backend/BackendClient";
import { electronAPI } from "../../utils/electronAPI";
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
	suggestedPath?: string;
	fileName?: string;
	savedFigures?: Array<{
		filename: string;
		fullPath: string;
		base64Data?: string;
		description: string;
	}>;
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
	 * Extract insights from plotting code
	 */
	private extractPlotInsights(code: string): string {
		const insights: string[] = [];
		
		// Libraries
		if (code.includes('plt.') || code.includes('matplotlib')) insights.push('matplotlib');
		if (code.includes('sns.') || code.includes('seaborn')) insights.push('seaborn');
		if (code.includes('plotly')) insights.push('plotly');
		
		// Plot types - simplified detection
		const plotPatterns = {
			'scatter': /\.(scatter|scatterplot)\(/,
			'line': /\.(plot|lineplot)\(/,
			'bar': /\.(bar|barplot)\(/,
			'histogram': /\.(hist|histogram)\(/,
			'heatmap': /\.heatmap\(/,
			'box': /\.(box|boxplot)\(/
		};
		
		for (const [type, pattern] of Object.entries(plotPatterns)) {
			if (pattern.test(code)) insights.push(type);
		}
		
		// Extract labels if present
		const titleMatch = code.match(/title\s*=\s*['"]([^'"]+)['"]/);
		if (titleMatch) insights.push(`"${titleMatch[1]}"`);
		
		return insights.length > 0 ? insights.join(', ') : 'visualization';
	}

	/**
	 * Extract saved figure files from code and outputs
	 */
	private extractSavedFigures(processedCells: ProcessedCell[], workspaceDir: string): Array<{filename: string, fullPath: string, description: string}> {
		const figureFiles: Array<{filename: string, fullPath: string, description: string}> = [];
		
		processedCells.forEach(cell => {
			// Look for plt.savefig() calls in code
			const saveFigMatches = cell.content.match(/(?:plt\.savefig|savefig)\s*\(\s*['"]([^'"]+\.(?:png|jpg|jpeg|pdf|svg))['"].*?\)/gi);
			if (saveFigMatches) {
				saveFigMatches.forEach(match => {
					const filenameMatch = match.match(/['"]([^'"]+\.(?:png|jpg|jpeg|pdf|svg))['"]/)
					if (filenameMatch) {
						const filename = filenameMatch[1];
						// Check if filename includes path, otherwise add figures subdirectory
						const fullPath = filename.includes('/') ? 
							`${workspaceDir}/${filename}` : 
							`${workspaceDir}/figures/${filename}`;
						const description = this.getFileDescription(filename);
						if (!figureFiles.some(f => f.filename === filename)) {
							figureFiles.push({ filename, fullPath, description });
						}
					}
				});
			}
			
			// Look for figure files mentioned in outputs
			if (cell.outputs) {
				cell.outputs.forEach(output => {
					// Look for filename patterns in outputs
					const filenameMatches = output.match(/([a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|pdf|svg))/g);
					if (filenameMatches) {
						filenameMatches.forEach(filename => {
							if (!figureFiles.some(f => f.filename === filename)) {
								// Figures are typically saved to the figures subdirectory
								const fullPath = `${workspaceDir}/figures/${filename}`;
								const description = this.getFileDescription(filename);
								figureFiles.push({ filename, fullPath, description });
							}
						});
					}
					
					// Look for "saved as" or similar patterns with path information
					const savedMatches = output.match(/(?:saved|written|created).*?(?:as|to)\s+([a-zA-Z0-9_./\\-]+\.(?:png|jpg|jpeg|pdf|svg))/gi);
					if (savedMatches) {
						savedMatches.forEach(match => {
							const filenameMatch = match.match(/([a-zA-Z0-9_./\\-]+\.(?:png|jpg|jpeg|pdf|svg))/i);
							if (filenameMatch && !figureFiles.some(f => f.filename === filenameMatch[1])) {
								const filepath = filenameMatch[1];
								// If path is provided, use it; otherwise assume figures subdirectory
								const fullPath = filepath.includes('/') ? 
									`${workspaceDir}/${filepath}` : 
									`${workspaceDir}/figures/${filepath}`;
								const filename = filepath.split('/').pop() || filepath;
								const description = this.getFileDescription(filename);
								figureFiles.push({ filename, fullPath, description });
							}
						});
					}
				});
			}
		});
		
		return figureFiles;
	}

	/**
	 * Load image file as base64 data URL
	 */
	private async loadImageAsBase64(filePath: string): Promise<string | null> {
		try {
			console.log(`Attempting to load image: ${filePath}`);
			
			// First check if file exists
			const fileExists = await (window as any).electronAPI?.getFileInfo?.(filePath);
			console.log(`File exists check:`, fileExists);
			
			// Call electron API directly instead of using the utility
			const result = await (window as any).electronAPI.readFileBinary(filePath);
			console.log(`Image load result:`, result);
			
			if (result?.dataUrl) {
				console.log(`Successfully loaded image: ${filePath}`);
				return result.dataUrl;
			} else {
				console.warn(`Image load failed - no dataUrl in result:`, result);
			}
		} catch (error) {
			console.error(`Failed to load image ${filePath}:`, error);
		}
		return null;
	}

	/**
	 * Get simple description from figure filename
	 */
	private getFileDescription(filename: string): string {
		const name = filename.toLowerCase();
		
		// Common plot types
		const types = ['scatter', 'heatmap', 'violin', 'box', 'bar', 'hist', 'umap', 'tsne', 'pca'];
		const foundType = types.find(type => name.includes(type));
		
		if (foundType) return `${foundType} plot`;
		if (name.includes('qc')) return 'quality control plot';
		if (name.includes('gene')) return 'gene analysis plot';
		return 'figure';
	}

	/**
	 * Extract key results from outputs - simplified
	 */
	private extractKeyResults(processedCells: ProcessedCell[]): string[] {
		const results = new Set<string>();
		
		processedCells.forEach(cell => {
			cell.outputs?.forEach(output => {
				// Look for common patterns
				const patterns = [
					/\b(accuracy|precision|recall|f1.score|r2.score):\s*([\d.]+)/gi,
					/\b(mean|median|std|min|max):\s*([\d.-]+)/gi,
					/shape:\s*\((\d+,\s*\d+)\)/gi,
					/([\d.]+)%/g
				];
				
				patterns.forEach(pattern => {
					const matches = [...output.matchAll(pattern)];
					matches.slice(0, 3).forEach(match => { // Limit matches per pattern
						results.add(match[0].trim());
					});
				});
			});
		});
		
		return Array.from(results).slice(0, 10); // Return top 10 results
	}

	/**
	 * Generate report path in workspace reports/ folder with timestamp
	 */
	private generateReportPath(notebookPath: string, fileName: string, format: string): string {
		// Extract workspace directory from notebook path
		const workspaceDir = notebookPath.substring(0, notebookPath.lastIndexOf('/'));
		
		// Create reports subdirectory path
		const reportsDir = `${workspaceDir}/reports`;
		
		// Get file extension
		const extension = format === 'html' ? '.html' : format === 'pdf' ? '.pdf' : '.md';
		
		return `${reportsDir}/${fileName}${extension}`;
	}

	/**
	 * Extract quantitative results and metrics from processed cells
	 */
	private extractQuantitativeResults(processedCells: ProcessedCell[]): string[] {
		const results: string[] = [];
		
		processedCells.forEach(cell => {
			if (cell.outputs) {
				cell.outputs.forEach(output => {
					// Extract specific quantitative patterns
					const quantPatterns = [
						// Statistical measures
						/accuracy[:\s]+([\d.]+)%?/gi,
						/precision[:\s]+([\d.]+)%?/gi,
						/recall[:\s]+([\d.]+)%?/gi,
						/f1[_\s-]?score[:\s]+([\d.]+)/gi,
						/r2[_\s]?score[:\s]+([\d.]+)/gi,
						/correlation[:\s]+([\d.-]+)/gi,
						/p[_\s]?value[:\s]+([\d.e-]+)/gi,
						/mse[:\s]+([\d.e-]+)/gi,
						/rmse[:\s]+([\d.e-]+)/gi,
						/mae[:\s]+([\d.e-]+)/gi,
						// Data characteristics
						/shape[:\s]+\((\d+,\s*\d+)\)/gi,
						/(\d+)\s+rows?,\s*(\d+)\s+columns?/gi,
						/mean[:\s]+([\d.-]+)/gi,
						/median[:\s]+([\d.-]+)/gi,
						/std[:\s]+([\d.-]+)/gi,
						/min[:\s]+([\d.-]+)/gi,
						/max[:\s]+([\d.-]+)/gi,
						// Counts and percentages
						/(\d+)\s+cells?\s+with\s+missing\s+values/gi,
						/(\d+)\s+unique\s+values/gi,
						/([\d.]+)%\s+missing/gi,
						/([\d.]+)%\s+complete/gi,
						// Scientific notation and large numbers
						/([\d.]+e[+-]?\d+)/gi,
						// Percentages
						/([\d.]+)%/g
					];
					
					quantPatterns.forEach(pattern => {
						const matches = output.match(pattern);
						if (matches) {
							matches.forEach(match => {
								// Clean up the match and make it more readable
								let cleanMatch = match.trim();
								if (!results.includes(cleanMatch) && cleanMatch.length > 3) {
									results.push(cleanMatch);
								}
							});
						}
					});
					
					// Look for model evaluation results
					const modelEvalPatterns = [
						/Train\s+(?:accuracy|loss|score)[:\s]+([\d.-]+)/gi,
						/Test\s+(?:accuracy|loss|score)[:\s]+([\d.-]+)/gi,
						/Validation\s+(?:accuracy|loss|score)[:\s]+([\d.-]+)/gi,
						/Cross.validation\s+score[:\s]+([\d.-]+)/gi,
					];
					
					modelEvalPatterns.forEach(pattern => {
						const matches = output.match(pattern);
						if (matches) {
							matches.forEach(match => {
								const cleanMatch = match.trim();
								if (!results.includes(cleanMatch)) {
									results.push(cleanMatch);
								}
							});
						}
					});
					
					// Extract data summary information
					if (output.includes('describe()') || output.includes('info()') || output.includes('value_counts()')) {
						// Look for summary statistics in pandas describe output
						const lines = output.split('\n');
						lines.forEach(line => {
							if (/count\s+[\d.]+/.test(line) || 
								/mean\s+[\d.-]+/.test(line) || 
								/std\s+[\d.-]+/.test(line)) {
								const statMatch = line.trim();
								if (statMatch.length > 0 && !results.includes(statMatch)) {
									results.push(statMatch);
								}
							}
						});
					}
				});
			}
			
			// Extract results from visual outputs
			if (cell.visualOutputs) {
				cell.visualOutputs.forEach(visual => {
					if (visual.type === 'table' && visual.data) {
						// Extract key information from table data
						const tableText = typeof visual.data === 'string' ? visual.data : '';
						if (tableText.includes('dtype:')) {
							// DataFrame info
							const lines = tableText.split('\n');
							const dataTypeInfo = lines.find(line => line.includes('dtype:'));
							if (dataTypeInfo && !results.includes(dataTypeInfo.trim())) {
								results.push(dataTypeInfo.trim());
							}
						}
					}
				});
			}
		});
		
		// Limit to most relevant results (avoid overwhelming the AI)
		return results.slice(0, 15).filter(result => result.length > 5);
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
        filePath: string,
        sessionId?: string,
        onStream?: (chunk: string) => void
    ): Promise<GeneratedSummary> {
		const processedCells = this.processCells(cells, options.selectedCells);
		const analysis = this.analyzeNotebook(cells, filePath);

		// Build context for AI model
		const context = this.buildAnalysisContext(processedCells, analysis, options);
		
        // Generate summary using backend AI
        const summaryContent = await this.generateAISummary(context, options, sessionId, onStream);

		// Format the final summary with workspace context
		const formattedSummary = this.formatSummary(summaryContent, options, analysis, filePath);

		// Load figure data for HTML embedding
		const workspaceDir = filePath.substring(0, filePath.lastIndexOf('/'));
		const figuresWithPaths = this.extractSavedFigures(processedCells, workspaceDir);
		console.log(`Detected ${figuresWithPaths.length} figures:`, figuresWithPaths);
		
		const savedFiguresWithData = await Promise.all(
			figuresWithPaths.map(async (figure) => {
				const base64Data = await this.loadImageAsBase64(figure.fullPath);
				return {
					...figure,
					base64Data: base64Data || undefined
				};
			})
		);
		
		console.log(`Loaded ${savedFiguresWithData.filter(f => f.base64Data).length}/${savedFiguresWithData.length} figures with data`);

		// Generate timestamped filename and suggested path
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); // 2025-01-01T12-30-00
		const reportType = options.reportType.replace('-', '_');
		const fileName = `${analysis.title}_${reportType}_${timestamp}`;
		const suggestedPath = this.generateReportPath(filePath, fileName, options.outputFormat);

		return {
			title: `${analysis.title} - ${this.getReportTypeLabel(options.reportType)}`,
			content: formattedSummary,
			format: options.outputFormat,
			generatedAt: new Date().toISOString(),
			options,
			analysis,
			suggestedPath,
			fileName,
			savedFigures: savedFiguresWithData.length > 0 ? savedFiguresWithData : undefined,
		};
	}

	/**
	 * Generate summary and automatically export to reports folder
	 */
	async generateAndExportSummary(
		cells: NotebookCell[],
		options: SummaryOptions,
		filePath: string,
		sessionId?: string,
		onStream?: (chunk: string) => void
	): Promise<{ summary: GeneratedSummary; exportResult: { success: boolean; filePath?: string } }> {
		// Generate the summary
		const summary = await this.generateSummary(cells, options, filePath, sessionId, onStream);
		
		// Automatically export to suggested path
		const exportResult = await this.exportSummary(summary);
		
		return { summary, exportResult };
	}

	/**
	 * Build context for AI analysis - simplified
	 */
	private buildAnalysisContext(
		processedCells: ProcessedCell[],
		analysis: NotebookAnalysis,
		options: SummaryOptions
	): string {
		const sections = [];
		
		// Basic overview
		sections.push(`# Notebook: ${analysis.title}`);
		sections.push(`${processedCells.length} cells selected, ${analysis.hasOutputs ? 'with outputs' : 'no outputs'}`);
		
		// Key results
		const keyResults = this.extractKeyResults(processedCells);
		if (keyResults.length > 0) {
			sections.push(`\n## Key Results\n${keyResults.map((r: string) => `- ${r}`).join('\n')}`);
		}
		
		// Figures
		const workspaceDir = analysis.title.includes('/') ? analysis.title.substring(0, analysis.title.lastIndexOf('/')) : '.';
		const savedFigures = this.extractSavedFigures(processedCells, workspaceDir);
		if (savedFigures.length > 0) {
			sections.push(`\n## Figures Generated\n${savedFigures.map(f => `- ${f.filename} (${f.description})`).join('\n')}`);
		}
		
		// Cell content
		sections.push('\n## Analysis Content');
		processedCells.forEach(cell => {
			sections.push(`\n### Cell ${cell.index + 1}`);
			
			if (options.includeCode && cell.content) {
				sections.push(`\`\`\`${cell.type}\n${cell.content}\n\`\`\``);
			}
			
			if (options.includeOutputs && cell.outputs?.length) {
				sections.push(`**Output:**\n\`\`\`\n${cell.outputs.join('\n')}\n\`\`\``);
			}
			
			if (cell.visualOutputs?.length) {
				const plots = cell.visualOutputs.filter(v => v.type === 'figure');
				if (plots.length > 0) {
					const plotInfo = this.extractPlotInsights(cell.content);
					sections.push(`**Visualization:** ${plotInfo}`);
				}
			}
		});
		
		return sections.join('\n');
	}

	/**
	 * Generate AI summary - simplified
	 */
    private async generateAISummary(context: string, options: SummaryOptions, sessionId?: string, onStream?: (chunk: string) => void): Promise<string> {
		try {
			const prompt = this.buildPrompt(options.reportType, options.summaryLength);
			
			if (onStream) {
				// Use streaming version
				let fullResponse = '';
				console.log('Starting streaming summary generation...');
				
				try {
					await this.backendClient.askQuestionStream(
						{
							question: prompt,
							context: context,
							sessionId,
						},
						(event: any) => {
							console.log('Streaming event:', event);
							if (event.type === 'answer' && typeof event.delta === 'string') {
								fullResponse += event.delta;
								onStream(event.delta);
							}
							// Handle potential error events
							if (event.type === 'error') {
								console.error('Streaming error:', event);
							}
						}
					);
					
					console.log('Streaming completed, response length:', fullResponse.length);
					return fullResponse || this.getFallbackSummary(options);
				} catch (streamingError) {
					console.warn('Streaming failed, falling back to non-streaming:', streamingError);
					// Fall back to non-streaming if streaming fails
					const response = await this.backendClient.askQuestion({
						question: prompt,
						context: context,
						sessionId,
					});
					return response || this.getFallbackSummary(options);
				}
			} else {
				// Use non-streaming version
				const response = await this.backendClient.askQuestion({
					question: prompt,
					context: context,
					sessionId,
				});
				
				return response || this.getFallbackSummary(options);
			}
		} catch (error) {
			console.error('Error generating AI summary:', error);
			return this.getFallbackSummary(options);
		}
	}



	/**
	 * Build prompt for AI generation - simplified
	 */
	private buildPrompt(reportType: SummaryOptions['reportType'], summaryLength: SummaryOptions['summaryLength']): string {
		const lengthGuide = {
			'brief': 'Write a concise 150-250 word summary.',
			'medium': 'Write a detailed 400-600 word analysis.',
			'detailed': 'Write a comprehensive 800-1200 word report.',
			'comprehensive': 'Write an extensive 1500-2500 word analysis.'
		}[summaryLength] || 'Write a well-structured summary.';
		
		const typePrompts = {
			'quick-summary': 'Create a bullet-point summary focusing on data, methods, results, and key figures.',
			'research-report': 'Create a research report with Introduction, Methods, Results, Discussion, and Conclusion.',
			'technical-doc': 'Create technical documentation covering implementation details and methodology.'
		};
		
		const baseInstruction = 'Base your analysis entirely on the provided code, outputs, and results. Reference specific findings and figures by name.';
		
		return `${typePrompts[reportType] || 'Summarize the notebook analysis.'} ${lengthGuide} ${baseInstruction}`;
	}


	/**
	 * Format the generated summary based on output preferences
	 */
	private formatSummary(
		content: string, 
		options: SummaryOptions, 
		analysis: NotebookAnalysis,
		notebookPath: string
	): string {
		const timestamp = new Date().toLocaleString();
		const generationDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
		const generationTime = new Date().toLocaleTimeString();
		
		let formatted = `# ${analysis.title} - ${this.getReportTypeLabel(options.reportType)}\n\n`;
		
		// Enhanced metadata section
		formatted += `## Report Metadata\n`;
		formatted += `- **Generated on:** ${generationDate} at ${generationTime}\n`;
		formatted += `- **Source notebook:** \`${notebookPath.split('/').pop()}\`\n`;
		formatted += `- **Report type:** ${this.getReportTypeLabel(options.reportType)}\n`;
		formatted += `- **Analysis scope:** ${options.selectedCells.length} cells\n`;
		formatted += `- **Generated by:** Axon AI Summary Engine\n\n`;
		
		formatted += `---\n\n`;
		formatted += content;
		formatted += `\n\n---\n\n`;
		
		// Detailed analysis statistics
		formatted += `## Analysis Summary\n`;
		formatted += `- **Total cells in notebook:** ${analysis.cellCount}\n`;
		formatted += `- **Cells analyzed:** ${options.selectedCells.length}\n`;
		formatted += `- **Code cells:** ${analysis.codeCount}\n`;
		formatted += `- **Markdown cells:** ${analysis.markdownCount}\n`;
		formatted += `- **Contains executed outputs:** ${analysis.hasOutputs ? 'Yes' : 'No'}\n`;
		
		if (analysis.sections.length > 0) {
			formatted += `- **Document sections:** ${analysis.sections.join(', ')}\n`;
		}
		
		if (analysis.keyFindings.length > 0) {
			formatted += `\n### Key Findings Identified\n`;
			analysis.keyFindings.forEach((finding, idx) => {
				formatted += `${idx + 1}. ${finding}\n`;
			});
		}
		
		formatted += `\n### Content Options\n`;
		formatted += `- **Include code:** ${options.includeCode ? '✓ Yes' : '✗ No'}\n`;
		formatted += `- **Include outputs:** ${options.includeOutputs ? '✓ Yes' : '✗ No'}\n`;
		formatted += `- **Include figures:** ${options.includeFigures ? '✓ Yes' : '✗ No'}\n`;
		formatted += `- **Include tables:** ${options.includeTables ? '✓ Yes' : '✗ No'}\n`;
		formatted += `- **Summary length:** ${this.getSummaryLengthLabel(options.summaryLength)}\n`;

		return formatted;
	}

	/**
	 * Simple fallback when AI generation fails
	 */
	private getFallbackSummary(options: SummaryOptions): string {
		return `# Summary Generation Failed\n\nCouldn't generate AI summary. Selected ${options.selectedCells.length} cells for ${this.getReportTypeLabel(options.reportType).toLowerCase()}.`;
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
	 * Get readable length label
	 */
	private getSummaryLengthLabel(summaryLength: SummaryOptions['summaryLength']): string {
		const labels = {
			'brief': 'Brief',
			'medium': 'Medium',
			'detailed': 'Detailed',
			'comprehensive': 'Comprehensive'
		};
		return labels[summaryLength] || 'Medium';
	}

	/**
	 * Export summary to file with automatic reports directory creation
	 */
	async exportSummary(summary: GeneratedSummary, outputPath?: string): Promise<{ success: boolean; filePath?: string }> {
		try {
			// Use suggested path if no output path provided
			const finalOutputPath = outputPath || summary.suggestedPath;
			if (!finalOutputPath) {
				throw new Error('No output path specified and no suggested path available');
			}

			// Ensure reports directory exists
			const reportsDir = finalOutputPath.substring(0, finalOutputPath.lastIndexOf('/'));
			await this.ensureDirectoryExists(reportsDir);

			let finalContent = summary.content;
			
			// Format based on output type
			if (summary.format === 'html') {
				finalContent = this.convertMarkdownToHTML(summary.content, summary.savedFigures);
			} else if (summary.format === 'pdf') {
				// For PDF, we'll convert to HTML first and then use Electron's built-in PDF generation
				const result = await this.generatePDF(summary, finalOutputPath);
				return { success: result, filePath: result ? finalOutputPath : undefined };
			}

			// Use electron API to write file
			const result = await electronAPI.writeFile(finalOutputPath, finalContent);
			return { 
				success: result.success === true, 
				filePath: result.success === true ? finalOutputPath : undefined 
			};
		} catch (error) {
			console.error('Error exporting summary:', error);
			return { success: false };
		}
	}

	/**
	 * Ensure directory exists, create if it doesn't
	 */
	private async ensureDirectoryExists(dirPath: string): Promise<void> {
		try {
			// Check if directory exists
			const existsResult = await electronAPI.directoryExists(dirPath);
			if (!existsResult.success || !existsResult.data) {
				// Create directory recursively
				const createResult = await electronAPI.createDirectory(dirPath);
				if (createResult.success) {
					console.log(`Created reports directory: ${dirPath}`);
				} else {
					console.warn(`Failed to create directory: ${createResult.error}`);
				}
			}
		} catch (error) {
			console.error('Error ensuring directory exists:', error);
			// Continue anyway - the file write might still work
		}
	}

	/**
	 * Generate PDF using Electron's built-in PDF capabilities
	 */
	private async generatePDF(summary: GeneratedSummary, outputPath: string): Promise<boolean> {
		try {
			// Convert markdown to HTML first
			const htmlContent = this.convertMarkdownToHTML(summary.content, summary.savedFigures);
			
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
	 * Basic markdown to HTML conversion with embedded image support
	 */
	private convertMarkdownToHTML(markdown: string, savedFigures?: Array<{filename: string, fullPath: string, base64Data?: string, description: string}>): string {
		// Basic markdown to HTML conversion
		// In a real implementation, you'd use a proper markdown parser
		let html = markdown
			.replace(/^# (.+)$/gm, '<h1>$1</h1>')
			.replace(/^## (.+)$/gm, '<h2>$1</h2>')
			.replace(/^### (.+)$/gm, '<h3>$1</h3>')
			.replace(/^\* (.+)$/gm, '<li>$1</li>')
			.replace(/^---$/gm, '<hr>')
			.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
			.replace(/\*(.+?)\*/g, '<em>$1</em>')
			.replace(/`(.+?)`/g, '<code>$1</code>')
			.replace(/```(.+?)```/gs, '<pre><code>$1</code></pre>')
			.replace(/\n/g, '<br>\n');

		// If we have figures with base64 data, embed them in HTML
		let figuresHtml = '';
		if (savedFigures && savedFigures.length > 0) {
			figuresHtml += '\n<div class="figures-section">\n';
			figuresHtml += '<h2>Generated Figures</h2>\n';
			
			savedFigures.forEach((figure, index) => {
				figuresHtml += `<div class="figure-container">\n`;
				figuresHtml += `<h3>Figure ${index + 1}: ${figure.filename}</h3>\n`;
				
				if (figure.base64Data) {
					// Only embed PNG, JPG, JPEG, and SVG images (not PDF)
					const extension = figure.filename.split('.').pop()?.toLowerCase();
					if (['png', 'jpg', 'jpeg', 'svg'].includes(extension || '')) {
						figuresHtml += `<img src="${figure.base64Data}" alt="${figure.filename}" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 5px; margin: 10px 0;">\n`;
					} else {
						figuresHtml += `<p><strong>File:</strong> ${figure.filename} (${extension?.toUpperCase()} format - not displayed inline)</p>\n`;
					}
				} else {
					figuresHtml += `<p><strong>File:</strong> ${figure.filename} (file not found or could not be loaded)</p>\n`;
				}
				
				if (figure.description) {
					figuresHtml += `<p class="figure-description"><em>${figure.description}</em></p>\n`;
				}
				figuresHtml += '</div>\n';
			});
			
			figuresHtml += '</div>\n';
		}

		return `<!DOCTYPE html>
<html>
<head>
	<title>Notebook Summary</title>
	<style>
		body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
		code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }
		pre { background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto; }
		hr { border: none; border-top: 1px solid #ddd; margin: 20px 0; }
		.figures-section { margin-top: 30px; border-top: 2px solid #e0e0e0; padding-top: 20px; }
		.figure-container { margin-bottom: 30px; }
		.figure-description { color: #666; font-style: italic; margin-top: 5px; }
	</style>
</head>
<body>
${html}
${figuresHtml}
</body>
</html>`;
	}
}
