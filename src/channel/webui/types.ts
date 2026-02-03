import type { PendingApprovalBase } from '../../shared/base-permission-manager.js';

export interface WebUIConfig {
  password?: string;
}

export interface WebUIContext {
  connectionId: string;
  project: string;
}

export interface PendingWebUIApproval extends PendingApprovalBase {
  webUIContext: WebUIContext;
}
