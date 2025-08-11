import React, { useState } from "react";
import styled from "styled-components";
import { Button } from "@components/shared/StyledComponents";
import { typography } from "../../styles/design-system";

const Backdrop = styled.div`
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.6);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 2000;
`;

const Modal = styled.div`
	width: 640px;
	max-width: 95vw;
	background: #1e1e1e;
	border: 1px solid #2f2f2f;
	border-radius: 8px;
	padding: 20px;
	color: #e0e0e0;
`;

const Title = styled.div`
	font-size: ${typography.xl};
	font-weight: 600;
	margin-bottom: 12px;
`;

const Description = styled.div`
	color: #9aa0a6;
	margin-bottom: 16px;
	font-size: ${typography.sm};
`;

const FormGrid = styled.div`
	display: grid;
	grid-template-columns: 1fr;
	gap: 12px;
`;

const Field = styled.div`
	display: flex;
	flex-direction: column;
	gap: 6px;
`;

const Label = styled.label`
	font-size: ${typography.sm};
	color: #cfcfcf;
`;

const Input = styled.input`
	background: #2a2a2a;
	border: 1px solid #3a3a3a;
	border-radius: 6px;
	padding: 8px 10px;
	color: #e0e0e0;
	outline: none;
	font-size: ${typography.sm};
	width: 100%;
`;

// removed textarea; we only accept remote address now

const Row = styled.div`
	grid-column: 1 / -1;
`;

const Actions = styled.div`
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	margin-top: 16px;
`;

export const SSHConnectModal: React.FC<{
	onCancel: () => void;
	onConnect: (target: string) => Promise<void> | void;
	isConnecting?: boolean;
	error?: string | null;
}> = ({ onCancel, onConnect, isConnecting, error }) => {
	const [target, setTarget] = useState("");
	const canSubmit = target.trim().length > 0 && target.includes("@");

	const handleConnect = async () => {
		await onConnect(target.trim());
	};

	return (
		<Backdrop>
			<Modal role="dialog" aria-modal>
				<Title>Connect to Remote Server</Title>
				<Description>
					Enter SSH details to start a secure terminal session. Credentials are
					used only for this session and are not stored.
				</Description>
				<FormGrid>
					<Field>
						<Label>Remote address</Label>
						<Input
							placeholder="user@host[:port]"
							value={target}
							onChange={(e) => setTarget(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && canSubmit && !isConnecting)
									handleConnect();
							}}
						/>
					</Field>
				</FormGrid>

				{error && (
					<div
						style={{ color: "#ff6b6b", marginTop: 10, fontSize: typography.sm }}
					>
						{error}
					</div>
				)}

				<Actions>
					<Button
						$variant="secondary"
						onClick={onCancel}
						disabled={!!isConnecting}
					>
						Cancel
					</Button>
					<Button
						$variant="primary"
						onClick={handleConnect}
						disabled={!canSubmit || !!isConnecting}
					>
						{isConnecting ? "Connecting..." : "Connect"}
					</Button>
				</Actions>
			</Modal>
		</Backdrop>
	);
};
