import { useEffect } from "react";

interface UseVirtualEnvEventsProps {
	setVirtualEnvStatus: (status: string) => void;
	addMessage: (content: string, isUser: boolean) => void;
}

export function useVirtualEnvEvents({
	setVirtualEnvStatus,
	addMessage,
}: UseVirtualEnvEventsProps) {
	useEffect(() => {
		let isMounted = true;

		const handleVirtualEnvStatus = (data: any) => {
			if (!isMounted) return;
			setVirtualEnvStatus(data.status || data.message || "");
			if (data.status === "installing_package" && data.package) {
				addMessage(`Installing: ${data.package}`, false);
			} else if (data.status === "packages_installed") {
				addMessage(`${data.message}`, false);
			} else if (data.status === "existing") {
				addMessage(`♻️ ${data.message}`, false);
			} else if (data.status === "completed") {
				addMessage(`${data.message}`, false);
			} else if (data.status === "error") {
				addMessage(`${data.message}`, false);
			}
		};

		// Listen for Jupyter ready events
		const handleJupyterReady = (data: any) => {
			if (!isMounted) return;
			if (data.status === "ready") {
				addMessage(`Jupyter environment ready!`, false);
			} else if (data.status === "error") {
				addMessage(`Jupyter setup failed: ${data.message}`, false);
			} else if (data.status === "starting") {
				addMessage(`Starting Jupyter server...`, false);
			}
		};

		// Listen for Python setup status updates
		const handlePythonSetupStatus = (data: any) => {
			if (!isMounted) return;
			setVirtualEnvStatus(data.message || "");

			if (data.status === "required") {
				addMessage(`🐍 ${data.message}`, false);
				if (data.reason) {
					addMessage(`💡 ${data.reason}`, false);
				}
				addMessage(
					`📦 This is a one-time setup for optimal compatibility`,
					false
				);
			} else if (data.status === "downloading") {
				// Update status but don't spam chat with download progress
				if (data.progress && data.progress % 25 === 0) {
					addMessage(`📥 ${data.message}`, false);
				}
			} else if (data.status === "installing") {
				addMessage(`⚙️ ${data.message}`, false);
			} else if (data.status === "completed") {
				addMessage(`✅ ${data.message}`, false);
				addMessage(`🚀 Ready for data analysis with modern Python!`, false);
			} else if (data.status === "error") {
				addMessage(`❌ ${data.message}`, false);
				if (data.error) {
					addMessage(`Error details: ${data.error}`, false);
				}
				addMessage(
					`💡 You can install Python 3.11+ manually as an alternative`,
					false
				);
			}
		};

		// Listen for package installation progress updates
		const handlePackageInstallProgress = (data: any) => {
			if (!isMounted) return;

			if (data.message && data.message.trim()) {
				// Filter and format pip output messages
				const msg = data.message.trim();
				if (msg.includes("Collecting")) {
					addMessage(`📥 ${msg}`, false);
				} else if (msg.includes("Downloading")) {
					// Only show major downloads, not every chunk
					if (msg.includes(" MB") || msg.includes(" KB")) {
						addMessage(`⬇️ ${msg}`, false);
					}
				} else if (msg.includes("Installing")) {
					addMessage(`⚙️ ${msg}`, false);
				} else if (msg.includes("Successfully installed")) {
					addMessage(`✅ ${msg}`, false);
				} else if (msg.includes("ERROR") || msg.includes("Failed")) {
					addMessage(`❌ ${msg}`, false);
				}
			}
		};

		// Add event listeners
		window.addEventListener(
			"virtual-env-status",
			handleVirtualEnvStatus as EventListener
		);
		window.addEventListener(
			"jupyter-ready",
			handleJupyterReady as EventListener
		);
		window.addEventListener(
			"python-setup-status",
			handlePythonSetupStatus as EventListener
		);
		window.addEventListener(
			"package-install-progress",
			handlePackageInstallProgress as EventListener
		);

		// Cleanup
		return () => {
			isMounted = false;
			window.removeEventListener(
				"virtual-env-status",
				handleVirtualEnvStatus as EventListener
			);
			window.removeEventListener(
				"jupyter-ready",
				handleJupyterReady as EventListener
			);
			window.removeEventListener(
				"python-setup-status",
				handlePythonSetupStatus as EventListener
			);
			window.removeEventListener(
				"package-install-progress",
				handlePackageInstallProgress as EventListener
			);
		};
	}, [setVirtualEnvStatus, addMessage]);
}