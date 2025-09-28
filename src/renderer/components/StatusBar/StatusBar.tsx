import React from "react";
import styled from "styled-components";
import {
	useWorkspaceContext,
	useAnalysisContext,
} from "../../context/AppContext";
import { typography } from "../../styles/design-system";
import { BackendClient } from "../../services/backend/BackendClient";

const StatusBarContainer = styled.div`
	height: 24px;
	background: #222;
	display: flex;

	align-items: center;
	justify-content: space-between;
	padding: 0 4px;
	font-size: ${typography.sm};
	color: white;
	flex-shrink: 0;
	border-top: 1px solid #444;
`;

const StatusLeft = styled.div`
	display: flex;
	align-items: center;
	gap: 12px;
`;

const StatusRight = styled.div`
	display: flex;
	align-items: center;
	gap: 12px;
`;

const StatusItem = styled.div`
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 2px 6px;

	font-weight: 500;
	transition: background-color 0.2s;
`;

export const StatusBar: React.FC = () => {
    const { state } = useWorkspaceContext();
    const { state: analysisState } = useAnalysisContext();

    // Feature flag: disable status bar token updates entirely
    const SHOW_TOKEN_STATS = false;

    const [tokenStats, setTokenStats] = React.useState<{
        approx: number;
        limit: number;
        near: boolean;
    } | null>(null);

    React.useEffect(() => {
        if (!SHOW_TOKEN_STATS) {
            // Ensure stats are cleared and skip polling when disabled
            setTokenStats(null);
            return;
        }
        let mounted = true;
        const client = new BackendClient();
        const intervalMs = 10000;

		async function poll() {
			try {
				const ws = state.currentWorkspace || "";
				const chatId = (analysisState as any).activeChatSessionId || "global";
				if (!ws) {
					if (mounted) setTokenStats(null);
					return;
				}
				// Backend now handles fuzzy matching, so try the most specific session ID first
				const sid = (client.scopeSessionId(undefined, ws, chatId) || "").trim();
	            		if (!sid) {
	            			if (mounted) setTokenStats(null);
	            			return;
	            		}
	            		const stats = await client.getSessionStats(sid);
            		if (!mounted) return;
            		setTokenStats({
					approx: stats.approx_tokens || 0,
					limit: stats.limit_tokens || 0,
					near: !!stats.near_limit,
				});
			} catch (e) {
            		// Silently ignore token stats errors when polling
				if (mounted) setTokenStats(null);
			}
		}

		// initial and interval
        poll();
        const t = setInterval(poll, intervalMs);
        return () => {
            mounted = false;
            clearInterval(t);
        };
    }, [state.currentWorkspace, (analysisState as any).activeChatSessionId]);

	return (
		<StatusBarContainer>
			<StatusLeft>
				<StatusItem>
					{state.currentWorkspace
						? `Workspace: ${state.currentWorkspace}`
						: "No workspace"}
				</StatusItem>
			</StatusLeft>

			<StatusRight>
            {SHOW_TOKEN_STATS && tokenStats && tokenStats.limit > 0 && (
                <StatusItem title={`LLM session tokens used`}>
                    <span style={{ color: tokenStats.near ? "#ff5555" : "#9aa0a6" }}>
                        Tokens:
                    </span>
                    <span style={{ fontWeight: 600 }}>
                        {Math.round(tokenStats.approx / 100) / 10}k /{" "}
                        {Math.round(tokenStats.limit / 1000)}k
                    </span>
                </StatusItem>
            )}
				<StatusItem>
					<span
						className={analysisState.isStreaming ? "pulse-dot" : ""}
						style={{
							display: "inline-block",
							width: 8,
							height: 8,
							borderRadius: "50%",
							backgroundColor: analysisState.isStreaming
								? "#00ff00"
								: "#9aa0a6",
							animation: analysisState.isStreaming
								? "pulse 1.5s infinite"
								: "none",
						}}
					/>
					{analysisState.isStreaming ? "Streaming" : "Ready"}
				</StatusItem>
			</StatusRight>
		</StatusBarContainer>
	);
};
