/**
 * Action-required status is decided by the backend and delivered on the client
 * payload (`Client.actionRequired`) and on `GET /clients/alerts`. The frontend
 * only renders it — deriving it here again would let the dashboard disagree
 * with the badges shown on the clients page.
 */
export type {
  ActionRequiredReason,
  ClientActionRequired as ActionRequiredStatus,
} from "@babyjamjam/shared/types/client-action-required";
