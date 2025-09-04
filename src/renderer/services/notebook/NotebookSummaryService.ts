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
	 * Analyze figure content using code context (synchronous for now)
	 * In the future, this could use AI vision models to analyze the actual image
	 */
	private analyzeFigureContent(imageData: string, cellCode: string): string | null {
		try {
			// For now, we'll analyze based on the code that generated the figure
			const codeAnalysis = this.extractVisualizationInsights(cellCode);
			return codeAnalysis;
		} catch (error) {
			console.warn('Error analyzing figure content:', error);
			return null;
		}
	}

	/**
	 * Extract figure-related context from code
	 */
	private extractFigureContext(code: string): string {
		const insights: string[] = [];
		
		// Look for plotting libraries and methods
		if (code.includes('matplotlib') || code.includes('plt.')) {
			insights.push('Created using Matplotlib');
		}
		if (code.includes('seaborn') || code.includes('sns.')) {
			insights.push('Created using Seaborn');
		}
		if (code.includes('plotly')) {
			insights.push('Created using Plotly (interactive)');
		}
		
		// Extract plot types
		const plotTypes = [];
		if (code.includes('.scatter(') || code.includes('scatterplot')) plotTypes.push('scatter plot');
		if (code.includes('.plot(') || code.includes('lineplot')) plotTypes.push('line plot');
		if (code.includes('.bar(') || code.includes('barplot')) plotTypes.push('bar chart');
		if (code.includes('.hist(') || code.includes('histogram')) plotTypes.push('histogram');
		if (code.includes('.box(') || code.includes('boxplot')) plotTypes.push('box plot');
		if (code.includes('.heatmap(')) plotTypes.push('heatmap');
		if (code.includes('.violin(') || code.includes('violinplot')) plotTypes.push('violin plot');
		
		if (plotTypes.length > 0) {
			insights.push(`Plot type(s): ${plotTypes.join(', ')}`);
		}
		
		// Look for titles, labels, and annotations
		const titleMatch = code.match(/title\s*=\s*['"]([^'"]+)['"]/);
		if (titleMatch) insights.push(`Title: "${titleMatch[1]}"`);
		
		const xlabelMatch = code.match(/xlabel\s*=\s*['"]([^'"]+)['"]/);
		if (xlabelMatch) insights.push(`X-axis: ${xlabelMatch[1]}`);
		
		const ylabelMatch = code.match(/ylabel\s*=\s*['"]([^'"]+)['"]/);
		if (ylabelMatch) insights.push(`Y-axis: ${ylabelMatch[1]}`);
		
		return insights.join('; ');
	}

	/**
	 * Extract visualization insights from code
	 */
	private extractVisualizationInsights(code: string): string {
		const insights: string[] = [];
		
		// Look for data being plotted
		const dataVariables: string[] = [];
		const dataVarMatches = code.match(/(\w+)\s*\[\s*['"]([^'"]+)['"]\s*\]/g);
		if (dataVarMatches) {
			dataVarMatches.forEach(match => {
				const varMatch = match.match(/(\w+)\s*\[\s*['"]([^'"]+)['"]\s*\]/);
				if (varMatch) {
					dataVariables.push(`${varMatch[1]}['${varMatch[2]}']`);
				}
			});
		}
		
		if (dataVariables.length > 0) {
			insights.push(`Data variables: ${dataVariables.join(', ')}`);
		}
		
		// Look for grouping/coloring
		const colorMatch = code.match(/(?:color|hue|c)\s*=\s*['"]?([^'",\s)]+)['"]?/);
		if (colorMatch) insights.push(`Grouped by: ${colorMatch[1]}`);
		
		// Look for size variations
		const sizeMatch = code.match(/(?:size|s)\s*=\s*['"]?([^'",\s)]+)['"]?/);
		if (sizeMatch) insights.push(`Sized by: ${sizeMatch[1]}`);
		
		// Look for statistical operations
		if (code.includes('corr()')) insights.push('Shows correlation analysis');
		if (code.includes('value_counts()')) insights.push('Shows frequency distribution');
		if (code.includes('describe()')) insights.push('Shows statistical summary');
		if (code.includes('groupby(')) insights.push('Shows grouped analysis');
		
		// Look for filtering or subsetting
		const filterMatches = code.match(/\[([^\]]+\s*[<>=!]+\s*[^\]]+)\]/g);
		if (filterMatches) {
			insights.push(`Applied filters: ${filterMatches.slice(0, 2).join(', ')}`);
		}
		
		return insights.join('; ');
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
						const description = this.analyzeFigureFilename(filename);
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
								const description = this.analyzeFigureFilename(filename);
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
								const description = this.analyzeFigureFilename(filename);
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
	 * Analyze figure filename to extract insights about its content
	 */
	private analyzeFigureFilename(filename: string): string {
		const insights: string[] = [];
		const nameLower = filename.toLowerCase();
		
		// Plot type detection
		if (nameLower.includes('umap')) insights.push('UMAP dimensionality reduction plot');
		if (nameLower.includes('tsne')) insights.push('t-SNE dimensionality reduction plot');
		if (nameLower.includes('pca')) insights.push('PCA analysis plot');
		if (nameLower.includes('heatmap')) insights.push('Heatmap visualization');
		if (nameLower.includes('scatter')) insights.push('Scatter plot');
		if (nameLower.includes('violin')) insights.push('Violin plot');
		if (nameLower.includes('box')) insights.push('Box plot');
		if (nameLower.includes('bar')) insights.push('Bar chart');
		if (nameLower.includes('hist')) insights.push('Histogram');
		if (nameLower.includes('corr')) insights.push('Correlation analysis');
		
		// Biology/analysis context
		if (nameLower.includes('gene')) insights.push('Gene expression analysis');
		if (nameLower.includes('marker')) insights.push('Marker gene analysis');
		if (nameLower.includes('qc')) insights.push('Quality control metrics');
		if (nameLower.includes('filter')) insights.push('Filtering analysis');
		if (nameLower.includes('cluster')) insights.push('Clustering analysis');
		if (nameLower.includes('cell')) insights.push('Cell-level analysis');
		if (nameLower.includes('before')) insights.push('Pre-processing state');
		if (nameLower.includes('after')) insights.push('Post-processing state');
		
		// Specific gene names or markers
		const geneMatches = filename.match(/([A-Z][A-Z0-9]+\d+|CD\d+|[A-Z]{2,}[0-9]+)/g);
		if (geneMatches) {
			insights.push(`Specific markers: ${geneMatches.join(', ')}`);
		}
		
		// Dataset or sample identifiers
		if (nameLower.includes('_bm_')) insights.push('Bone marrow dataset');
		if (nameLower.includes('_pbmc_')) insights.push('PBMC dataset');
		
		// Metrics or measurements
		if (nameLower.includes('metric')) insights.push('Quantitative metrics visualization');
		if (nameLower.includes('count')) insights.push('Count-based analysis');
		if (nameLower.includes('expression')) insights.push('Expression level analysis');
		
		return insights.length > 0 ? `Likely content: ${insights.join('; ')}` : '';
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
        sessionId?: string
    ): Promise<GeneratedSummary> {
		const processedCells = this.processCells(cells, options.selectedCells);
		const analysis = this.analyzeNotebook(cells, filePath);

		// Build context for AI model
		const context = this.buildAnalysisContext(processedCells, analysis, options);
		
        // Generate summary using backend AI
        const summaryContent = await this.generateAISummary(context, options, sessionId);

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
		sessionId?: string
	): Promise<{ summary: GeneratedSummary; exportResult: { success: boolean; filePath?: string } }> {
		// Generate the summary
		const summary = await this.generateSummary(cells, options, filePath, sessionId);
		
		// Automatically export to suggested path
		const exportResult = await this.exportSummary(summary);
		
		return { summary, exportResult };
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

		// Extract and highlight actual quantitative results
		const quantitativeResults = this.extractQuantitativeResults(processedCells);
		if (quantitativeResults.length > 0) {
			context += `## ACTUAL QUANTITATIVE RESULTS (USE THESE SPECIFIC VALUES)\n`;
			quantitativeResults.forEach((result, idx) => {
				context += `${idx + 1}. ${result}\n`;
			});
			context += `\n`;
		}

		// Extract and highlight saved figure files
		const workspaceDir = analysis.title.includes('/') 
			? analysis.title.substring(0, analysis.title.lastIndexOf('/'))
			: '.';
		const savedFigures = this.extractSavedFigures(processedCells, workspaceDir);
		if (savedFigures.length > 0) {
			context += `## ACTUAL SAVED FIGURE FILES (REFERENCE THESE SPECIFIC FILES)\n`;
			context += `The following figure files were generated and saved during the analysis:\n`;
			savedFigures.forEach((figure, idx) => {
				context += `${idx + 1}. **${figure.filename}** - This figure file was actually created and saved\n`;
				// Include the description from filename analysis
				if (figure.description) {
					context += `   ${figure.description}\n`;
				}
			});
			context += `\n**REPORT INSTRUCTION**: Reference these specific figure files by name in your report. ` +
				`Describe what each figure likely contains based on its filename and the analysis context.\n\n`;
		}

		// Cell contents with enhanced output emphasis
		context += `## Cell Contents and Execution Results\n\n`;
		processedCells.forEach(cell => {
			context += `### Cell ${cell.index + 1} (${cell.type.toUpperCase()})\n`;
			
			if (cell.content) {
				if (options.includeCode || cell.type === 'markdown') {
					context += `**Code executed:**\n`;
					context += `\`\`\`${cell.type === 'code' ? 'python' : 'markdown'}\n`;
					context += cell.content;
					context += `\n\`\`\`\n\n`;
				}
			}
			
			if (options.includeOutputs && cell.outputs && cell.outputs.length > 0) {
				context += `**ACTUAL EXECUTION OUTPUTS (cite these exact results):**\n`;
				cell.outputs.forEach((output, idx) => {
					context += `Output ${idx + 1}:\n\`\`\`\n${output}\n\`\`\`\n`;
				});
				context += `\n`;
			}
			
			// Include visual outputs if requested with enhanced descriptions
			if (cell.visualOutputs && cell.visualOutputs.length > 0) {
				const figures = cell.visualOutputs.filter(vo => vo.type === 'figure');
				const tables = cell.visualOutputs.filter(vo => vo.type === 'table');
				
				if (options.includeFigures && figures.length > 0) {
					context += `**ACTUAL FIGURES GENERATED (analyze and describe these specific visualizations):**\n`;
					for (let idx = 0; idx < figures.length; idx++) {
						const figure = figures[idx];
						context += `\n### Figure ${idx + 1}: ${figure.description} (${figure.format})\n`;
						context += `- **Generated by code execution**: This visualization was actually created during the analysis\n`;
						
						// If we have the actual image data, we can analyze it
						if (figure.data && figure.format === 'png') {
							const figureAnalysis = this.analyzeFigureContent(figure.data, cell.content);
							if (figureAnalysis) {
								context += `- **Visual Analysis**: ${figureAnalysis}\n`;
							}
						}
						
						// Extract any figure-related context from the code that generated it
						const codeContext = this.extractFigureContext(cell.content);
						if (codeContext) {
							context += `- **Code Context**: ${codeContext}\n`;
						}
						
						context += `- **Report Instruction**: Describe what this figure shows, interpret its findings, and reference specific visual elements\n`;
					}
					context += `\n`;
				}
				
				if (options.includeTables && tables.length > 0) {
					context += `**ACTUAL TABLES GENERATED (reference this real data):**\n`;
					tables.forEach((table, idx) => {
						context += `- Table ${idx + 1}: ${table.description} (${table.format})\n`;
						if (table.format === 'text' && table.data) {
							// Include more of the actual table data
							const preview = table.data.substring(0, 500).replace(/\n/g, '\n  ');
							context += `  ACTUAL DATA:\n  ${preview}${table.data.length > 500 ? '\n  ...(truncated)' : ''}\n`;
						}
					});
					context += `\n`;
				}
			}
		});

		return context;
	}

	/**
	 * Generate AI summary using backend client with length validation
	 */
    private async generateAISummary(context: string, options: SummaryOptions, sessionId?: string): Promise<string> {
		const prompt = this.buildSummaryPrompt(options.reportType, options.summaryLength);
		const maxAttempts = 2;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				console.log(`Generating summary attempt ${attempt}/${maxAttempts} for ${options.summaryLength} length...`);
				
				// Use the backend client's askQuestion method for AI generation
				const response = await this.backendClient.askQuestion({
					question: attempt === 1 ? prompt : this.buildRetryPrompt(prompt, options.summaryLength),
					context: context,
					sessionId,
				});

				if (response) {
					// Validate length
					const wordCount = this.countWords(response);
					const { min, max, target } = this.getWordCountLimits(options.summaryLength);
					
					console.log(`Generated summary: ${wordCount} words (target: ${min}-${max})`);
					
					// If within acceptable range or last attempt, return it
					if (wordCount >= min && wordCount <= max) {
						console.log(`✅ Summary length acceptable: ${wordCount} words`);
						return response;
					} else if (attempt === maxAttempts) {
						console.log(`⚠️ Final attempt: ${wordCount} words (outside ${min}-${max} range)`);
						return response;
					} else {
						console.log(`❌ Length out of range: ${wordCount} words, retrying...`);
						// Continue to next attempt
					}
				}
			} catch (error) {
				console.error(`Error generating AI summary (attempt ${attempt}):`, error);
				if (attempt === maxAttempts) {
					return this.generateFallbackSummary(context, options);
				}
			}
		}

		return this.generateFallbackSummary(context, options);
	}

	/**
	 * Count words in text
	 */
	private countWords(text: string): number {
		return text.trim().split(/\s+/).filter(word => word.length > 0).length;
	}

	/**
	 * Get word count limits for different summary lengths
	 */
	private getWordCountLimits(summaryLength: SummaryOptions['summaryLength']): { min: number; max: number; target: number } {
		switch (summaryLength) {
			case 'brief':
				return { min: 120, max: 300, target: 200 };
			case 'medium':
				return { min: 350, max: 650, target: 500 };
			case 'detailed':
				return { min: 700, max: 1300, target: 1000 };
			case 'comprehensive':
				return { min: 1200, max: 2800, target: 2000 };
			default:
				return { min: 350, max: 650, target: 500 };
		}
	}

	/**
	 * Build retry prompt for length adjustment
	 */
	private buildRetryPrompt(originalPrompt: string, summaryLength: SummaryOptions['summaryLength']): string {
		const { min, max, target } = this.getWordCountLimits(summaryLength);
		
		return `🚨 CRITICAL LENGTH REQUIREMENT 🚨

Your previous response was TOO SHORT. You MUST write EXACTLY ${min}-${max} words (target: ${target} words).

STRICT INSTRUCTIONS:
1. COUNT your words as you write
2. DO NOT stop until you reach AT LEAST ${min} words
3. DO NOT exceed ${max} words
4. Add more technical details, specific results, code explanations, and figure descriptions to reach the target
5. Include more analysis of the actual data, methods used, and interpretation of results

` + originalPrompt + `

🎯 FINAL REMINDER: Write ${min}-${max} words. Your response will be rejected if it's outside this range.`;
	}


	/**
	 * Build report-specific prompts for AI generation
	 */
	private buildSummaryPrompt(reportType: SummaryOptions['reportType'], summaryLength: SummaryOptions['summaryLength']): string {
		const basePrompt = "You are an expert data scientist and technical writer. ";
		
		// Get length-specific instructions
		const lengthInstruction = this.getLengthInstruction(summaryLength);
		
		// Emphasize using actual results including figures
		const resultsEmphasis = "CRITICAL: Base your report ENTIRELY on the actual code, outputs, figures, and results provided in the context. " +
			"Do NOT make generic assumptions. Reference specific numerical results, actual code functions used, " +
			"real figures/tables generated, and concrete findings from the execution outputs. " +
			"IMPORTANT FOR FIGURES: When figures are provided, you MUST describe what they show, interpret their findings, " +
			"and explain their significance. Reference the plot types, data variables, groupings, and visual patterns. " +
			"Treat figures as PRIMARY EVIDENCE and integrate their insights into your analysis. " +
			"If specific results are shown in the outputs, cite them directly. ";
		
		switch (reportType) {
			case 'quick-summary':
				return basePrompt + resultsEmphasis +
					"Create a concise, bullet-point summary of this Jupyter notebook based on the ACTUAL analysis performed. " +
					"Focus on: (1) What specific data was analyzed, (2) Which exact methods/libraries were used in the code, " +
					"(3) The actual numerical results and findings from the outputs, (4) DETAILED descriptions of figures/visualizations generated, " +
					"explaining what each plot shows and what insights can be drawn from it. For every figure mentioned, describe the plot type, " +
					"data being visualized, and key visual findings. Reference specific values, metrics, and visual patterns. " + lengthInstruction;
			
			case 'research-report':
				return basePrompt + resultsEmphasis +
					"Create a comprehensive research report based on this ACTUAL Jupyter notebook analysis. " +
					"Structure it with: Introduction (based on actual data loaded), Methods (citing specific code and libraries used), " +
					"Results (using exact numerical outputs AND detailed figure analysis), Discussion (interpreting actual findings including visual evidence), " +
					"and Conclusion (based on real results). CRITICAL: Dedicate significant space to describing and interpreting each figure. " +
					"For each visualization, explain: what type of plot it is, what data is shown, what patterns are visible, and what this means for the analysis. " +
					"Integrate figure insights throughout the Results and Discussion sections. " + lengthInstruction;
			
			case 'technical-doc':
				return basePrompt + resultsEmphasis +
					"Create detailed technical documentation for this Jupyter notebook based on the ACTUAL code executed. " +
					"Document: (1) Exact libraries and functions used, (2) Specific parameters and configurations from the code, " +
					"(3) Step-by-step methodology as actually implemented, (4) Real outputs and their interpretations, " +
					"(5) COMPREHENSIVE figure documentation - for each visualization, document the plotting code used, data variables, " +
					"plot parameters, and interpretation of what the figure reveals. Include technical details about figure creation " +
					"and data visualization choices. Focus on what was ACTUALLY done, not what could be done. " + lengthInstruction;
			
			default:
				return basePrompt + resultsEmphasis + 
					"Summarize this Jupyter notebook based on the ACTUAL code, outputs, and results provided. " +
					"Focus on what was actually accomplished, not generic possibilities. " + lengthInstruction;
		}
	}

	/**
	 * Get length-specific instruction for AI prompts with enforced word counts
	 */
	private getLengthInstruction(summaryLength: SummaryOptions['summaryLength']): string {
		switch (summaryLength) {
			case 'brief':
				return "STRICT LENGTH REQUIREMENT: Write EXACTLY 150-250 words. Count your words and stop precisely within this range. " +
					"Focus only on the most critical findings and methods. Be extremely concise and direct.";
			case 'medium':
				return "STRICT LENGTH REQUIREMENT: Write EXACTLY 400-600 words. Count your words carefully. " +
					"Include key methodology, main findings, and important details. Provide sufficient depth while staying within the word limit.";
			case 'detailed':
				return "STRICT LENGTH REQUIREMENT: Write EXACTLY 800-1200 words. This must be a comprehensive analysis. " +
					"Include detailed methodology, all significant findings, statistical results, interpretations, and conclusions. " +
					"Expand on each section thoroughly while maintaining the exact word count range.";
			case 'comprehensive':
				return "STRICT LENGTH REQUIREMENT: Write EXACTLY 1500-2500 words. This is a full research report. " +
					"Include extensive methodology details, complete statistical analysis, all findings with interpretations, " +
					"discussion of implications, limitations, and detailed conclusions. Write as if for academic publication. " +
					"Use multiple paragraphs and detailed explanations to reach the required word count.";
			default:
				return "Create a well-structured summary with appropriate level of detail, targeting approximately 500 words.";
		}
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
	 * Get human-readable summary length labels with actual word counts
	 */
	private getSummaryLengthLabel(summaryLength: SummaryOptions['summaryLength']): string {
		const limits = this.getWordCountLimits(summaryLength);
		switch (summaryLength) {
			case 'brief':
				return `Brief (${limits.min}-${limits.max} words)`;
			case 'medium':
				return `Medium (${limits.min}-${limits.max} words)`;
			case 'detailed':
				return `Detailed (${limits.min}-${limits.max} words)`;
			case 'comprehensive':
				return `Comprehensive (${limits.min}-${limits.max} words)`;
			default:
				return 'Medium (350-650 words)';
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
