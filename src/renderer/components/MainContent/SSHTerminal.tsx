import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { ActionButton } from "@components/shared/StyledComponents";
import { typography } from "../../styles/design-system";

const Container = styled.div`
	position: fixed;
	inset: 40px 20px 20px 20px;
	background: #0b0b0b;
	border: 1px solid #2a2a2a;
	border-radius: 8px;
	display: flex;
	flex-direction: column;
	z-index: 1500;
`;

const Header = styled.div`
	height: 40px;
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 10px;
	background: #161616;
	border-bottom: 1px solid #2a2a2a;
	color: #ddd;
`;

const Title = styled.div`
	font-weight: 600;
`;

const TerminalWrapper = styled.div`
	flex: 1;
	overflow: hidden;
	padding: 6px;
`;

export interface SSHTerminalProps {
	sessionId: string;
	targetLabel: string;
	onClose: () => void;
}

export const SSHTerminal: React.FC<SSHTerminalProps> = ({
	sessionId,
	targetLabel,
	onClose,
}) => {
	const termRef = useRef<HTMLDivElement | null>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const [authVisible, setAuthVisible] = useState(false);
	const [authMessage, setAuthMessage] = useState<string>("");
	const [authEcho, setAuthEcho] = useState<boolean>(false);
	const [authValue, setAuthValue] = useState<string>("");

	useEffect(() => {
		const term = new Terminal({
			fontFamily: 'Menlo, Monaco, "Courier New", monospace',
			fontSize: 13,
			theme: {
				background: "#0b0b0b",
				foreground: "#e2e2e2",
			},
			cursorBlink: true,
			scrollback: 5000,
		});
		const fit = new FitAddon();
		terminalRef.current = term;
		fitRef.current = fit;
		term.loadAddon(fit);
		if (termRef.current) {
			term.open(termRef.current);
			try {
				fit.fit();
			} catch {}
		}

		const handleResize = () => {
			try {
				fit.fit();
			} catch {}
			const cols = term.cols;
			const rows = term.rows;
			(window as any).electronAPI?.sshResize?.(sessionId, cols, rows);
		};

		window.addEventListener("resize", handleResize);

		const onData = (data: any) => {
			if (data?.sessionId !== sessionId) return;
			if (typeof data.data === "string") {
				term.write(data.data);
			}
		};
		const onErr = (data: any) => {
			if (data?.sessionId !== sessionId) return;
			term.write(`\r\n[SSH ERROR] ${data.error || data}\r\n`);
		};
		const onClosed = (data: any) => {
			if (data?.sessionId !== sessionId) return;
			term.write("\r\n[Session closed]\r\n");
		};

		(window as any).electronAPI?.onSSHData?.(onData);
		(window as any).electronAPI?.onSSHError?.(onErr);
		(window as any).electronAPI?.onSSHClosed?.(onClosed);
		(window as any).electronAPI?.onSSHAuthPrompt?.((data: any) => {
			if (data?.sessionId !== sessionId) return;
			const prompt =
				Array.isArray(data?.prompts) && data.prompts.length > 0
					? data.prompts[0]
					: null;
			const message = prompt?.prompt || "Password:";
			setAuthMessage(message);
			setAuthEcho(!!prompt?.echo);
			setAuthValue("");
			setAuthVisible(true);
		});

		term.onData((d) => {
			(window as any).electronAPI?.sshWrite?.(sessionId, d);
		});

		// Initial resize inform
		setTimeout(handleResize, 50);

		return () => {
			try {
				window.removeEventListener("resize", handleResize);
			} catch {}
			try {
				(window as any).electronAPI?.removeAllListeners?.("ssh-data");
			} catch {}
			try {
				(window as any).electronAPI?.removeAllListeners?.("ssh-error");
			} catch {}
			try {
				(window as any).electronAPI?.removeAllListeners?.("ssh-closed");
			} catch {}
			try {
				(window as any).electronAPI?.removeAllListeners?.("ssh-auth-prompt");
			} catch {}
			try {
				term.dispose();
			} catch {}
		};
	}, [sessionId]);

	const submitAuth = async () => {
		try {
			await (window as any).electronAPI?.sshAuthAnswer?.(sessionId, [
				authValue,
			]);
		} finally {
			setAuthVisible(false);
			setAuthValue("");
		}
	};

	return (
		<Container>
			<Header>
				<Title>SSH: {targetLabel}</Title>
				<ActionButton $variant="secondary" onClick={onClose}>
					Close
				</ActionButton>
			</Header>
			<TerminalWrapper>
				<div ref={termRef} style={{ width: "100%", height: "100%" }} />
				{authVisible && (
					<div
						style={{
							position: "absolute",
							top: 60,
							left: "50%",
							transform: "translateX(-50%)",
							background: "#1e1e1e",
							border: "1px solid #444",
							borderRadius: 8,
							padding: 12,
							minWidth: 360,
							zIndex: 1600,
							boxShadow: "0 6px 24px rgba(0,0,0,0.6)",
						}}
					>
						<div
							style={{
								color: "#e0e0e0",
								fontWeight: 600,
								marginBottom: 6,
								fontSize: typography.base,
							}}
						>
							Authentication required
						</div>
						<div
							style={{
								color: "#9aa0a6",
								marginBottom: 8,
								fontSize: typography.sm,
							}}
						>
							{authMessage}
						</div>
						<input
							type={authEcho ? "text" : "password"}
							value={authValue}
							onChange={(e) => setAuthValue(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") submitAuth();
								if (e.key === "Escape") setAuthVisible(false);
							}}
							style={{
								width: "100%",
								background: "#2a2a2a",
								border: "1px solid #3a3a3a",
								color: "#e0e0e0",
								borderRadius: 6,
								padding: "8px 10px",
								outline: "none",
							}}
							autoFocus
						/>
						<div
							style={{
								display: "flex",
								gap: 8,
								justifyContent: "flex-end",
								marginTop: 10,
							}}
						>
							<ActionButton
								$variant="secondary"
								onClick={() => setAuthVisible(false)}
							>
								Cancel
							</ActionButton>
							<ActionButton $variant="primary" onClick={submitAuth}>
								Submit
							</ActionButton>
						</div>
					</div>
				)}
			</TerminalWrapper>
		</Container>
	);
};
