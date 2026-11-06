export type ReviewStatus = "new" | "drafted" | "replied";

export interface ConnectionRow {
  id: string;
  user_id: string;
  google_sub: string;
  google_email: string | null;
  refresh_token_enc: string;
  scope: string | null;
  status: "active" | "revoked" | "error";
  last_error: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface LocationRow {
  id: string;
  user_id: string;
  connection_id: string;
  google_account_name: string;
  google_location_name: string;
  title: string;
  address: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  last_sync_error: string | null;
}

export interface ReviewRow {
  id: string;
  user_id: string;
  location_id: string;
  google_review_id: string;
  reviewer_name: string | null;
  reviewer_photo_url: string | null;
  star_rating: number;
  comment: string | null;
  google_create_time: string | null;
  google_update_time: string | null;
  status: ReviewStatus;
  ai_draft: string | null;
  final_reply: string | null;
  moderation_flags: string[];
  drafted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  published_at: string | null;
  publish_error: string | null;
  replied_on_google: boolean;
  locations?: { title: string } | null;
}

export interface SyncSummary {
  locations: number;
  newReviews: number;
  updatedReviews: number;
  draftsCreated: number;
  errors: { location: string; code: string; message: string }[];
}
