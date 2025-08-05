import React from "react";
import { DataTypeSuggestions, AnalysisSuggestion } from "../../services/AnalysisSuggestionsService";

interface AnalysisSuggestionsComponentProps {
	suggestions: DataTypeSuggestions;
	onSuggestionSelect: (suggestion: AnalysisSuggestion) => void;
	onCustomAnalysis: () => void;
}

export const AnalysisSuggestionsComponent: React.FC<AnalysisSuggestionsComponentProps> = ({
	suggestions,
	onSuggestionSelect,
	onCustomAnalysis,
}) => {
	const getComplexityColor = (complexity: string) => {
		switch (complexity) {
			case "easy": return "#28a745";
			case "medium": return "#ffc107";
			case "hard": return "#dc3545";
			default: return "#6c757d";
		}
	};

	const getComplexityEmoji = (complexity: string) => {
		switch (complexity) {
			case "easy": return "🟢";
			case "medium": return "🟡";
			case "hard": return "🔴";
			default: return "⚪";
		}
	};

	return (
		<div className="analysis-suggestions-container">
			<div className="suggestions-header">
				<h3>🔍 Analysis Suggestions Based on Your Data</h3>
				<p>Click on any suggestion to start the analysis:</p>
			</div>

			{suggestions.suggestions.length > 0 && (
				<div className="suggestions-section">
					<h4>Recommended Analyses:</h4>
					<div className="suggestions-grid">
						{suggestions.suggestions.map((suggestion, index) => (
							<div
								key={index}
								className="suggestion-card"
								onClick={() => onSuggestionSelect(suggestion)}
							>
								<div className="suggestion-header">
									<span className="suggestion-title">{suggestion.title}</span>
									<span 
										className="complexity-badge"
										style={{ backgroundColor: getComplexityColor(suggestion.complexity) }}
									>
										{getComplexityEmoji(suggestion.complexity)} {suggestion.complexity}
									</span>
								</div>
								
								<p className="suggestion-description">{suggestion.description}</p>
								
								<div className="suggestion-details">
									<div className="detail-item">
										<span className="detail-icon">⏱️</span>
										<span>{suggestion.estimated_time}</span>
									</div>
									<div className="detail-item">
										<span className="detail-icon">📊</span>
										<span>Insights: {suggestion.expected_insights.slice(0, 2).join(", ")}</span>
									</div>
								</div>
								
								<div className="suggestion-footer">
									<span className="click-hint">Click to start analysis →</span>
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{suggestions.recommended_approaches.length > 0 && (
				<div className="approaches-section">
					<h4>Recommended Approaches:</h4>
					<div className="approaches-list">
						{suggestions.recommended_approaches.map((approach, index) => (
							<div key={index} className="approach-item">
								<div className="approach-title">{approach.approach}</div>
								<div className="approach-description">{approach.description}</div>
								<div className="approach-tools">
									<span className="tools-label">Tools:</span>
									{approach.tools.map((tool, toolIndex) => (
										<span key={toolIndex} className="tool-badge">{tool}</span>
									))}
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			<div className="suggestions-actions">
				<button 
					className="custom-analysis-button"
					onClick={onCustomAnalysis}
				>
					🎯 Create Custom Analysis
				</button>
			</div>

			{suggestions.next_steps.length > 0 && (
				<div className="next-steps-section">
					<h4>Next Steps:</h4>
					<ol className="next-steps-list">
						{suggestions.next_steps.map((step, index) => (
							<li key={index}>{step}</li>
						))}
					</ol>
				</div>
			)}
		</div>
	);
};