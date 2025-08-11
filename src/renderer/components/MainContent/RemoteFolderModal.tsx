import React, { useState, useEffect } from "react";
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
  width: 560px;
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

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
`;

export const RemoteFolderModal: React.FC<{
  username: string;
  onCancel: () => void;
  onOpen: (remotePath: string) => Promise<void> | void;
  isWorking?: boolean;
  error?: string | null;
}> = ({ username, onCancel, onOpen, isWorking, error }) => {
  const [path, setPath] = useState<string>("");

  useEffect(() => {
    const defaultPath = username === "root" ? "/root" : `/home/${username}`;
    setPath(defaultPath);
  }, [username]);

  const canSubmit = path.trim().length > 0 && path.startsWith("/");

  const handleOpen = async () => {
    await onOpen(path.trim());
  };

  return (
    <Backdrop>
      <Modal role="dialog" aria-modal>
        <Title>Select Remote Folder</Title>
        <Description>
          Choose the remote path to work with. The folder will be mirrored locally and opened as a workspace.
        </Description>
        <Field>
          <Label>Remote path</Label>
          <Input
            placeholder="/home/user/project or /root"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit && !isWorking) handleOpen();
              if (e.key === "Escape") onCancel();
            }}
            autoFocus
          />
        </Field>
        {error && (
          <div style={{ color: "#ff6b6b", marginTop: 10, fontSize: typography.sm }}>{error}</div>
        )}
        <Actions>
          <Button $variant="secondary" onClick={onCancel} disabled={!!isWorking}>
            Cancel
          </Button>
          <Button $variant="primary" onClick={handleOpen} disabled={!canSubmit || !!isWorking}>
            {isWorking ? "Opening..." : "Open"}
          </Button>
        </Actions>
      </Modal>
    </Backdrop>
  );
};


