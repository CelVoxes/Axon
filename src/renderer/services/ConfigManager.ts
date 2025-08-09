/**
 * Centralized configuration management for the application
 */
export interface AppConfig {
	// Backend configuration
	backend: {
		baseUrl: string;
		timeout: number;
		retryAttempts: number;
	};

	// Analysis configuration
	analysis: {
		defaultModel: string;
		availableModels: string[];
		maxSteps: number;
		timeout: number;
		enableProgress: boolean;
	};

	// Workspace configuration
	workspace: {
		defaultPath: string;
		tempPath: string;
		maxSize: number;
		cleanupInterval: number;
	};

	// UI configuration
	ui: {
		statusBarHeight: number;
		animationDuration: number;
		enableAnimations: boolean;
		theme: "light" | "dark" | "auto";
	};

	// Logging configuration
	logging: {
		level: "debug" | "info" | "warn" | "error";
		enableConsole: boolean;
		enableFile: boolean;
		maxLogSize: number;
	};

	// Development configuration
	development: {
		enableDebugMode: boolean;
		enableHotReload: boolean;
		enableProfiling: boolean;
	};
}

export class ConfigManager {
	private config: AppConfig;
	private static instance: ConfigManager;

	private constructor() {
		this.config = this.loadDefaultConfig();
		this.loadFromEnvironment();
	}

	/**
	 * Get singleton instance
	 */
	static getInstance(): ConfigManager {
		if (!ConfigManager.instance) {
			ConfigManager.instance = new ConfigManager();
		}
		return ConfigManager.instance;
	}

	/**
	 * Get the entire configuration
	 */
	getConfig(): AppConfig {
		return { ...this.config };
	}

	/**
	 * Get a specific configuration section
	 */
	getSection<K extends keyof AppConfig>(section: K): AppConfig[K] {
		return { ...this.config[section] };
	}

	/**
	 * Get a specific configuration value
	 */
	getValue<K extends keyof AppConfig, SK extends keyof AppConfig[K]>(
		section: K,
		key: SK
	): AppConfig[K][SK] {
		return this.config[section][key];
	}

	/**
	 * Update a configuration value
	 */
	setValue<K extends keyof AppConfig, SK extends keyof AppConfig[K]>(
		section: K,
		key: SK,
		value: AppConfig[K][SK]
	): void {
		this.config[section][key] = value;
		this.saveToStorage();
	}

	/**
	 * Update multiple configuration values
	 */
	updateConfig(updates: Partial<AppConfig>): void {
		this.config = { ...this.config, ...updates };
		this.saveToStorage();
	}

	/**
	 * Reset configuration to defaults
	 */
	resetToDefaults(): void {
		this.config = this.loadDefaultConfig();
		this.saveToStorage();
	}

	/**
	 * Load configuration from environment variables
	 */
	private loadFromEnvironment(): void {
		// Backend configuration
		if (process.env.BACKEND_URL) {
			this.config.backend.baseUrl = process.env.BACKEND_URL;
		}
		if (process.env.BACKEND_TIMEOUT) {
			this.config.backend.timeout = parseInt(process.env.BACKEND_TIMEOUT);
		}

		// Analysis configuration
		if (process.env.DEFAULT_MODEL) {
			this.config.analysis.defaultModel = process.env.DEFAULT_MODEL;
		}
		if (process.env.MAX_ANALYSIS_STEPS) {
			this.config.analysis.maxSteps = parseInt(process.env.MAX_ANALYSIS_STEPS);
		}

		// Development configuration
		if (process.env.NODE_ENV === "development") {
			this.config.development.enableDebugMode = true;
		}
	}

	/**
	 * Load configuration from local storage
	 */
	private loadFromStorage(): void {
		try {
			const stored = localStorage.getItem("axon-config");
			if (stored) {
				const parsed = JSON.parse(stored);
				this.config = { ...this.config, ...parsed };
			}
		} catch (error) {
			console.warn("Failed to load configuration from storage:", error);
		}
	}

	/**
	 * Save configuration to local storage
	 */
	private saveToStorage(): void {
		try {
			localStorage.setItem("axon-config", JSON.stringify(this.config));
		} catch (error) {
			console.warn("Failed to save configuration to storage:", error);
		}
	}

	/**
	 * Load default configuration
	 */
	private loadDefaultConfig(): AppConfig {
		return {
			backend: {
				baseUrl: "http://localhost:8000",
				timeout: 30000,
				retryAttempts: 3,
			},
			analysis: {
				defaultModel: "gpt-4.1", // Uses Chain-of-Thought reasoning internally
				availableModels: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
				maxSteps: 20,
				timeout: 300000, // 5 minutes
				enableProgress: true,
			},
			workspace: {
				defaultPath: "/tmp/workspaces",
				tempPath: "/tmp/axon-temp",
				maxSize: 1024 * 1024 * 100, // 100MB
				cleanupInterval: 24 * 60 * 60 * 1000, // 24 hours
			},
			ui: {
				statusBarHeight: 24,
				animationDuration: 200,
				enableAnimations: true,
				theme: "auto",
			},
			logging: {
				level: "info",
				enableConsole: true,
				enableFile: false,
				maxLogSize: 1024 * 1024 * 10, // 10MB
			},
			development: {
				enableDebugMode: false,
				enableHotReload: false,
				enableProfiling: false,
			},
		};
	}

	/**
	 * Get the default LLM model
	 */
	getDefaultModel(): string {
		return this.config.analysis.defaultModel;
	}

	/**
	 * Get available LLM models
	 */
	getAvailableModels(): string[] {
		return this.config.analysis.availableModels;
	}

	/**
	 * Validate configuration
	 */
	validateConfig(): boolean {
		try {
			// Validate required fields
			if (!this.config.backend.baseUrl) {
				throw new Error("Backend base URL is required");
			}
			if (this.config.backend.timeout <= 0) {
				throw new Error("Backend timeout must be positive");
			}
			if (this.config.analysis.maxSteps <= 0) {
				throw new Error("Max analysis steps must be positive");
			}
			return true;
		} catch (error) {
			console.error("Configuration validation failed:", error);
			return false;
		}
	}

	/**
	 * Get configuration for a specific service
	 */
	getServiceConfig(serviceName: string): any {
		switch (serviceName) {
			case "BackendClient":
				return this.config.backend;
			case "AnalysisPlanner":
				return this.config.analysis;
			case "DatasetManager":
				return this.config.analysis;
			case "CodeGenerationService":
				return this.config.analysis;
			case "NotebookService":
				return this.config.workspace;
			case "CellExecutionService":
				return this.config.workspace;
			default:
				return {};
		}
	}
}
