// File size formatting utility
export const formatFileSize = (bytes: number): string => {
	if (bytes === 0) return "0 B";

	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

// Date formatting utility
export const formatDate = (date: Date): string => {
	const now = new Date();
	const diffInMs = now.getTime() - date.getTime();
	const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

	if (diffInDays === 0) {
		return "Today";
	} else if (diffInDays === 1) {
		return "Yesterday";
	} else if (diffInDays < 7) {
		return `${diffInDays} days ago`;
	} else {
		return date.toLocaleDateString();
	}
};

// File type icon mapping
export const getFileTypeIcon = (fileName: string): string => {
	const extension = fileName.split(".").pop()?.toLowerCase();

	switch (extension) {
		case "ipynb":
			return "📓";
		case "py":
			return "🐍";
		case "js":
		case "ts":
		case "jsx":
		case "tsx":
			return "⚛️";
		case "json":
			return "📄";
		case "csv":
			return "📊";
		case "md":
		case "txt":
			return "📝";
		case "png":
		case "jpg":
		case "jpeg":
		case "gif":
		case "svg":
			return "🖼️";
		case "pdf":
			return "📕";
		case "zip":
		case "tar":
		case "gz":
			return "📦";
		default:
			return "📄";
	}
};

// Debounce utility
export const debounce = <T extends (...args: any[]) => any>(
	func: T,
	wait: number
): ((...args: Parameters<T>) => void) => {
	let timeout: NodeJS.Timeout;
	return (...args: Parameters<T>) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => func(...args), wait);
	};
};

// Throttle utility
export const throttle = <T extends (...args: any[]) => any>(
	func: T,
	limit: number
): ((...args: Parameters<T>) => void) => {
	let inThrottle: boolean;
	return (...args: Parameters<T>) => {
		if (!inThrottle) {
			func(...args);
			inThrottle = true;
			setTimeout(() => (inThrottle = false), limit);
		}
	};
};
