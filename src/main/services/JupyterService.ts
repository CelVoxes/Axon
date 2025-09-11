import * as path from "path";
import { BrowserWindow } from "electron";

export interface JupyterExecutionResult {
	success: boolean;
	output?: string;
	error?: string;
}

export interface JupyterConfig {
	port: number;
	executionTimeoutMs: number;
	connectionTimeoutMs: number;
	maxRetryAttempts: number;
	retryBackoffMs: number;
}

/**
 * Centralized Jupyter service handling all kernel management, WebSocket connections,
 * and code execution for Axon's biological analysis workflows
 */
export class JupyterService {
	private config: JupyterConfig;
	private mainWindow?: BrowserWindow;

	constructor(config: JupyterConfig, mainWindow?: BrowserWindow) {
		this.config = config;
		this.mainWindow = mainWindow;
	}

	/**
	 * Execute Python code in a Jupyter kernel for the given workspace
	 */
	async executeCode(
		code: string,
		workspacePath: string,
		executionId?: string,
		language: "python" | "r" = "python"
	): Promise<JupyterExecutionResult> {
		try {
			console.log(`🎯 Executing code in workspace: ${workspacePath}`);

			// Notify renderer that code execution is starting
			this.mainWindow?.webContents.send("jupyter-code-writing", {
				code: code,
				timestamp: new Date().toISOString(),
				type: "full_code",
				executionId,
			});

			// Create or get existing kernel of the requested language
			const kernelId = await this.getOrCreateKernel(workspacePath, language);

			// Execute code via WebSocket
			const result = await this.executeCodeInKernel(code, kernelId, executionId);

			return result;
		} catch (error) {
			console.error("Jupyter code execution error:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Get an existing running kernel or start a new one with minimal setup
	 */
	private async getOrCreateKernel(
		workspacePath: string,
		language: "python" | "r" = "python"
	): Promise<string> {
		try {
			// First, check for existing running kernels
			console.log(`🔍 Checking for existing running kernels...`);
			const kernelsResp = await fetch(
				`http://127.0.0.1:${this.config.port}/api/kernels`
			);

			if (kernelsResp.ok) {
				const runningKernels = await kernelsResp.json();
				console.log(`📋 Found ${runningKernels.length} running kernels`);

				// Try to find a kernel matching requested language
				const desired = (language === "r") ? "ir" : "python";
				const match = (runningKernels as any[]).find((k) =>
					String(k?.name || "").toLowerCase().includes(desired)
				);
				if (match) {
					console.log(
						`✅ Using existing ${language} kernel: ${match.name} (${match.id})`
					);
					return String(match.id);
				}

				// Fall back to any kernel if available and language is python
				if (language === "python" && runningKernels.length > 0) {
					const kernel = runningKernels[0];
					console.log(
						`ℹ️ No explicit python kernel found; using first available: ${kernel.name} (${kernel.id})`
					);
					return String(kernel.id);
				}
			}

			// If no running kernels, create one with workspace Python
			console.log(
				`🔧 No matching kernels found, creating a new ${language.toUpperCase()} kernel...`
			);

			// Since Jupyter server is running from workspace venv, create kernel without name
			// This will use the same Python that's running the Jupyter server
			const headers: any = { "Content-Type": "application/json" };

			// Prefer explicit kernel by name; fall back to server default if needed
			let createResp: Response;
			try {
				const kernelName = language === "r" ? "ir" : "python3";
				createResp = await Promise.race([
					fetch(`http://127.0.0.1:${this.config.port}/api/kernels`, {
						method: "POST",
						headers,
						body: JSON.stringify({ name: kernelName }),
					}),
					new Promise<Response>((_, reject) => {
						setTimeout(
							() => reject(new Error("Kernel creation timeout")),
							30000
						);
					}),
				]);
				if (!createResp.ok) {
					// Some servers may require empty body to use default kernel
					console.warn(
						`Kernel create with name=${language === "r" ? "ir" : "python3"} returned ${createResp.status}, retrying with default...`
					);
					createResp = await Promise.race([
						fetch(`http://127.0.0.1:${this.config.port}/api/kernels`, {
							method: "POST",
							headers,
							body: JSON.stringify({}),
						}),
						new Promise<Response>((_, reject) => {
							setTimeout(
								() => reject(new Error("Kernel creation timeout")),
								30000
							);
						}),
					]);
				}
			} catch (e) {
				throw e;
			}

			if (!createResp.ok) {
				const errText = await createResp.text().catch(() => "");
				console.error(`❌ Failed to create ${language.toUpperCase()} kernel:`);
				console.error(
					`   Status: ${createResp.status} ${createResp.statusText}`
				);
				console.error(`   Response: ${errText}`);
				throw new Error(
					language === "r"
						? `Failed to create R kernel. Ensure IRkernel is installed. ${errText}`
						: `Failed to create Python kernel: ${errText}`
				);
			}

			const newKernel = await createResp.json();
			console.log(
				`✅ Created kernel: ${newKernel.name} with id: ${newKernel.id}`
			);
			return newKernel.id as string;
		} catch (error) {
			console.error("Error getting kernel:", error);
			throw error;
		}
	}

	/**
	 * Execute code in a specific kernel via WebSocket
	 */
	private async executeCodeInKernel(
		code: string,
		kernelId: string,
		executionId?: string
	): Promise<JupyterExecutionResult> {
		const WebSocket = require("ws");
		const { v4: uuidv4 } = require("uuid");

		// Small delay to avoid race conditions
		await new Promise((r) => setTimeout(r, 200));

		// Use a stable session id for this connection (and reuse in message header)
		const sessionId = uuidv4();
		const wsUrl = `ws://127.0.0.1:${this.config.port}/api/kernels/${kernelId}/channels?session_id=${sessionId}`;
		console.log(`🔗 Connecting to WebSocket: ${wsUrl}`);

		return new Promise((resolve) => {
			let output = "";
			let errorOutput = "";
			let executionTimeoutId: NodeJS.Timeout | null = null;

			const attemptConnect = (attempt: number) => {
				console.log(
					`🔄 WebSocket connection attempt ${attempt}/${this.config.maxRetryAttempts}`
				);
				const ws = new WebSocket(wsUrl);

				// Track the msg_id for this execute_request so we filter messages correctly
				let currentMsgId: string | null = null;

				// Reset execution timeout on activity
				const resetExecutionTimeout = () => {
					if (executionTimeoutId) clearTimeout(executionTimeoutId);
					executionTimeoutId = setTimeout(() => {
						console.log("⏰ Jupyter execution timeout");
						try {
							ws.close();
						} catch (_) {}
						resolve({ success: false, error: "Execution timeout" });
					}, this.config.executionTimeoutMs);
				};

				// Connection timeout
				const connectionTimeout = setTimeout(() => {
					console.error("⏰ WebSocket connection timeout");
					try {
						ws.close();
					} catch (_) {}
					if (attempt < this.config.maxRetryAttempts) {
						setTimeout(
							() => attemptConnect(attempt + 1),
							this.config.retryBackoffMs
						);
					} else {
						resolve({ success: false, error: "WebSocket connection timeout" });
					}
				}, this.config.connectionTimeoutMs);

				ws.on("open", () => {
					console.log("✅ WebSocket connection opened");
					clearTimeout(connectionTimeout);
					resetExecutionTimeout();

					// Send execute request
					const msgId = uuidv4();
					currentMsgId = msgId;
					const executeRequest = {
						header: {
							msg_id: msgId,
							username: "user",
							session: sessionId,
							msg_type: "execute_request",
							version: "5.3",
						},
						parent_header: {},
						metadata: {},
						content: {
							code: code,
							silent: false,
							store_history: true,
							user_expressions: {},
							allow_stdin: false,
							stop_on_error: true,
						},
						channel: "shell",
					};
					ws.send(JSON.stringify(executeRequest));
				});

				ws.on("error", (error: any) => {
					console.error("❌ WebSocket error:", error);
					if (executionTimeoutId) clearTimeout(executionTimeoutId);
					clearTimeout(connectionTimeout);
					if (attempt < this.config.maxRetryAttempts) {
						setTimeout(
							() => attemptConnect(attempt + 1),
							this.config.retryBackoffMs
						);
					} else {
						resolve({
							success: false,
							error: `WebSocket error: ${error.message}`,
						});
					}
				});

				ws.on("close", (code: any, reason: any) => {
					console.log(`🔌 WebSocket closed: ${code} - ${reason}`);
					if (!output && !errorOutput) {
						if (executionTimeoutId) clearTimeout(executionTimeoutId);
						clearTimeout(connectionTimeout);
						if (attempt < this.config.maxRetryAttempts) {
							setTimeout(
								() => attemptConnect(attempt + 1),
								this.config.retryBackoffMs
							);
						} else {
							resolve({
								success: false,
								error: `WebSocket closed unexpectedly: ${reason}`,
							});
						}
					}
				});

				ws.on("message", (data: any) => {
					try {
						const msg = JSON.parse(data.toString());
						const parentId = msg?.parent_header?.msg_id;
						if (!parentId || (currentMsgId && parentId !== currentMsgId)) {
							return; // ignore unrelated messages from other executions
						}

						// Handle different message types
						if (msg.parent_header && msg.header?.msg_type === "stream") {
							const text = msg.content?.text || "";
							output += text;

							this.mainWindow?.webContents.send("jupyter-code-writing", {
								code: output,
								timestamp: new Date().toISOString(),
								type: "stream",
								executionId,
							});
							resetExecutionTimeout();
						} else if (
							msg.parent_header &&
							(msg.header?.msg_type === "execute_result" ||
								msg.header?.msg_type === "display_data")
						) {
							try {
								const dataObj = msg.content?.data || {};
								const text =
									(dataObj["text/plain"] as string | undefined) || "";
								if (text) {
									output += (output ? "\n" : "") + text + "\n";
									this.mainWindow?.webContents.send("jupyter-code-writing", {
										code: output,
										timestamp: new Date().toISOString(),
										type: "stream",
										executionId,
									});
								}
								resetExecutionTimeout();
							} catch (displayError) {
								console.warn("⚠️ Error processing display data:", displayError);
							}
						} else if (
							msg.parent_header &&
							msg.header?.msg_type === "execute_reply"
						) {
							console.log(`📋 Execute reply:`, msg.content);
							if (msg.content?.status === "ok") {
								console.log(
									`✅ Execution successful, output length: ${output.length}`
								);
								if (executionTimeoutId) clearTimeout(executionTimeoutId);
								resolve({ success: true, output });
							} else {
								const error = msg.content?.evalue || "Unknown execution error";
								errorOutput += error;
								console.log(`❌ Execution failed: ${errorOutput}`);
								if (executionTimeoutId) clearTimeout(executionTimeoutId);
								resolve({ success: false, error: errorOutput });
							}
							try {
								ws.close();
							} catch (_) {}
						} else if (msg.parent_header && msg.header?.msg_type === "error") {
							const tb = Array.isArray(msg.content?.traceback)
								? (msg.content.traceback as string[]).join("\n")
								: "";
							errorOutput +=
								(errorOutput ? "\n" : "") +
								(msg.content?.evalue || "Error") +
								(tb ? "\n" + tb : "");
							console.log(
								`❌ Execution error: ${msg.content?.evalue || "Unknown error"}`
							);
							resetExecutionTimeout();
						}
					} catch (parseError) {
						console.error(
							"❌ Error parsing WebSocket message:",
							parseError,
							"Data:",
							data.toString().substring(0, 200)
						);
						resetExecutionTimeout();
					}
				});
			};

			// Start first connection attempt
			attemptConnect(1);
		});
	}

	/**
	 * Get default Jupyter configuration for Axon biological analysis workloads
	 */
	static getDefaultConfig(port: number): JupyterConfig {
		return {
			port,
			executionTimeoutMs: 600000, // 10 minutes for complex biological analysis
			connectionTimeoutMs: 30000, // 30 seconds
			maxRetryAttempts: 3,
			retryBackoffMs: 2000, // 2 seconds
		};
	}
}
