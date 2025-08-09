import React from "react";

interface ValidationErrorsProps {
	errors: string[];
}

export const ValidationErrors: React.FC<ValidationErrorsProps> = ({
	errors,
}) => {
	if (!errors || errors.length === 0) return null;
	return (
		<div className="validation-errors-indicator">
			<div className="validation-errors-header">
				<div className="validation-errors-title">
					<span>Code Validation Errors</span>
					<div className="error-dot"></div>
				</div>
			</div>
			<div className="validation-errors-details">
				{errors.map((error, index) => (
					<div key={index} className="validation-error-item">
						<span className="error-number">{index + 1}.</span>
						<span className="error-message">{error}</span>
					</div>
				))}
			</div>
		</div>
	);
};
